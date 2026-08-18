"""
F-19-A: Contextual chunk enrichment (Anthropic Contextual Retrieval).

Before embedding, each child chunk gets a short 50-100 token prefix situating
it within the document (book/chapter/topic). The context sent to the LLM for
this is a LOCAL window — the chunk's own parent plus its immediate neighbor
parents (see hierarchical_chunker.py) — not the whole document. Two reasons:

  1. Correctness: a chunk on page 300 needs context about page 300, not the
     book's opening pages. An earlier version of this module truncated to a
     flat prefix of the whole document, which was only ever accurate for
     chunks that happened to fall within that prefix — everything past it
     got a context prefix generated from irrelevant, unrelated content.
  2. Cost: a local window (~3 parents, ~4k tokens) is far cheaper to cache
     and re-read than a large document-wide prefix, and it's cached once
     PER PARENT (shared by that parent's ~3-4 children) rather than once
     for the entire document — so this is cheaper AND more accurate than
     the whole-document-prefix approach it replaced.

embedding_text (prefix + original) is what gets embedded/BM25-indexed.
original_text (unprefixed) is what the LLM sees at generation time — the
prefix would otherwise pollute every answer with a repeated preamble.
"""
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic

logger = logging.getLogger(__name__)

CONTEXTUALISER_ENABLED = os.environ.get("CONTEXTUALISER_ENABLED", "true").lower() == "true"
CONTEXTUALISER_MODEL = os.environ.get("CONTEXTUALISER_MODEL", "claude-haiku-4-5-20251001")
CONTEXTUALISER_MAX_TOKENS = int(os.environ.get("CONTEXTUALISER_MAX_TOKENS", "150"))
# How many neighboring parents (before AND after) to include alongside a
# chunk's own parent when building its local context window. 1 = current
# parent ± 1 neighbor on each side (~3 parents, ~4k tokens at PARENT_CHUNK_TOKENS
# default 1400) — enough to catch a heading/topic sentence that fell just
# before or after a parent boundary, without ballooning back toward
# whole-document cost.
CONTEXTUALISER_NEIGHBOR_PARENTS = int(os.environ.get("CONTEXTUALISER_NEIGHBOR_PARENTS", "1"))
CONTEXTUALISER_BATCH_SIZE = int(os.environ.get("CONTEXTUALISER_BATCH_SIZE", "10"))
CONTEXTUALISER_VERSION = int(os.environ.get("CONTEXTUALISER_VERSION", "2"))

# USD / 1M tokens — Claude Haiku 4.5 published rates, NOT the F-19 planning
# doc's illustrative worked-example numbers (those were ~4x too low and
# under-reported real spend even when caching works correctly). Cache write
# is 1.25x base input, cache read is 0.1x base input — Anthropic's standard
# prompt-caching multipliers, applied to Haiku 4.5's $1/$5 per-MTok base rates.
FRESH_INPUT_COST_PER_1M = 1.00
OUTPUT_COST_PER_1M = 5.00
CACHE_WRITE_COST_PER_1M = 1.25
CACHE_READ_COST_PER_1M = 0.10

_FILE_TYPE_LABELS = {
    "pdf": "textbook",
    "pptx": "lecture slide deck",
    "docx": "lecture notes document",
    "mp4": "lecture video transcript",
    "mkv": "lecture video transcript",
    "mp3": "lecture audio transcript",
    "m4a": "lecture audio transcript",
}

_CONTEXTUALISER_PROMPT_TEMPLATE = """Here is the chunk we want to situate within the whole document:
<chunk>
{chunk_content}
</chunk>

This document is a {doc_type} used in {dept_name} at an Indian {college_type} college.

Give a short, succinct context (50-100 tokens) to situate this chunk within the
overall document, for the purpose of improving search retrieval of the chunk.
Include: the book/document name, the chapter or section it belongs to, the page,
and the specific topic or entity being discussed (drug name, anatomical structure,
disease, algorithm, circuit type, etc.).

Answer only with the succinct context and nothing else."""

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def doc_type_label(file_type: str) -> str:
    return _FILE_TYPE_LABELS.get(file_type, "academic document")


def _build_local_windows(parents: list[dict]) -> dict[str, str]:
    """
    One window per parent: that parent's own text plus CONTEXTUALISER_NEIGHBOR_PARENTS
    parents on each side, in document order (parents list is already sequential —
    see hierarchical_chunker.py). This is genuinely local context, unlike a flat
    whole-document truncation which is only accurate for chunks near the start.
    """
    n = CONTEXTUALISER_NEIGHBOR_PARENTS
    windows: dict[str, str] = {}
    for i, parent in enumerate(parents):
        lo = max(0, i - n)
        hi = min(len(parents) - 1, i + n)
        windows[parent["_id"]] = "\n\n".join(p["text"] for p in parents[lo : hi + 1])
    return windows


def _contextualise_one(doc_context: str, child: dict, doc_type: str, dept_name: str, college_type: str) -> dict:
    client = _get_client()
    chunk_prompt = _CONTEXTUALISER_PROMPT_TEMPLATE.format(
        chunk_content=child["text"],
        doc_type=doc_type,
        dept_name=dept_name or "the department",
        college_type=college_type or "engineering",
    )

    try:
        response = client.messages.create(
            model=CONTEXTUALISER_MODEL,
            max_tokens=CONTEXTUALISER_MAX_TOKENS,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": f"<document>\n{doc_context}\n</document>",
                        # ── Cache breakpoint — first chunk writes, rest read ──
                        "cache_control": {"type": "ephemeral"},
                    },
                    {"type": "text", "text": chunk_prompt},
                ],
            }],
        )

        context_prefix = response.content[0].text.strip()
        cache_read = getattr(response.usage, "cache_read_input_tokens", 0) or 0
        cache_write = getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        fresh_input = response.usage.input_tokens
        output_tokens = response.usage.output_tokens

        cost_usd = (
            cache_write * CACHE_WRITE_COST_PER_1M
            + cache_read * CACHE_READ_COST_PER_1M
            + fresh_input * FRESH_INPUT_COST_PER_1M
            + output_tokens * OUTPUT_COST_PER_1M
        ) / 1_000_000

    except Exception as exc:
        logger.warning("Contextualiser call failed, chunk will embed without a context prefix: %s", exc)
        context_prefix = ""
        cache_read = cache_write = 0
        cost_usd = 0.0

    return {
        **child,
        "metadata": {
            **child["metadata"],
            "context_prefix": context_prefix,
            "contextualised": bool(context_prefix),
            "contextualiser_version": CONTEXTUALISER_VERSION,
        },
        "original_text": child["text"],
        "context_prefix": context_prefix,
        "embedding_text": f"{context_prefix}\n\n{child['text']}" if context_prefix else child["text"],
        "contextualiser_cost_usd": cost_usd,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
    }


def _contextualise_group(
    window: str,
    indexed_children: list[tuple[int, dict]],
    doc_type: str,
    dept_name: str,
    college_type: str,
) -> tuple[list[tuple[int, dict]], float]:
    """
    All children sharing one parent, contextualised SEQUENTIALLY against that
    parent's local window — the first call writes the cache, every call after
    it (still within this same group/thread) reads it. Groups are small
    (~3-4 children), so no in-group concurrency is needed; different groups
    use different window text (different cache entries), so running groups
    concurrently against EACH OTHER can't race the same cache write the way
    unconstrained per-chunk concurrency did before.
    """
    group_total = 0.0
    results: list[tuple[int, dict]] = []
    for i, child in indexed_children:
        result = _contextualise_one(window, child, doc_type, dept_name, college_type)
        results.append((i, result))
        group_total += result["contextualiser_cost_usd"]
    return results, group_total


def contextualise_children(
    children: list[dict],
    parents: list[dict],
    file_type: str,
    dept_name: str,
    college_type: str,
) -> tuple[list[dict], float]:
    """
    Adds embedding_text/original_text/context_prefix/contextualiser_* fields to
    every child chunk, using a window local to each chunk's own parent (see
    module docstring). Returns (contextualised_children, total_cost_usd).

    If disabled (or given no chunks), children pass through with embedding_text
    falling back to the raw chunk text, at zero cost.
    """
    if not CONTEXTUALISER_ENABLED or not children:
        passthrough = [
            {
                **c,
                "metadata": {**c["metadata"], "context_prefix": "", "contextualised": False},
                "original_text": c["text"],
                "context_prefix": "",
                "embedding_text": c["text"],
            }
            for c in children
        ]
        return passthrough, 0.0

    doc_type = doc_type_label(file_type)
    windows = _build_local_windows(parents)

    # Group children by parent — each group shares one cache entry (that
    # parent's local window), keyed so results can be restored to the
    # caller's original order afterward.
    groups: dict[str, list[tuple[int, dict]]] = {}
    for i, child in enumerate(children):
        pid = child["metadata"].get("parent_chunk_id")
        groups.setdefault(pid, []).append((i, child))

    results: list[dict | None] = [None] * len(children)
    total_cost = 0.0

    with ThreadPoolExecutor(max_workers=CONTEXTUALISER_BATCH_SIZE) as pool:
        futures = [
            pool.submit(
                _contextualise_group,
                # Defensive fallback for a child with no parent_chunk_id (shouldn't
                # happen — hierarchical_chunker always sets it): use the child's
                # own text as a minimal window rather than reintroducing a
                # whole-document truncation.
                windows.get(pid, indexed_children[0][1]["text"]),
                indexed_children,
                doc_type, dept_name, college_type,
            )
            for pid, indexed_children in groups.items()
        ]
        for future in as_completed(futures):
            group_results, group_cost = future.result()
            total_cost += group_cost
            for i, result in group_results:
                results[i] = result

    return results, round(total_cost, 6)  # type: ignore[return-value]
