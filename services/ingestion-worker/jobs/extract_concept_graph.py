"""
Concept graph extraction job — F-20-A.

Runs once per document, after F-13-A chapter extraction completes. Walks the
chapter map IN ORDER (chapters already resolved by extract_chapters.py and
passed in job_data) and asks Claude to extract the teachable concepts from
each chapter, constraining prerequisites to concepts already extracted from
EARLIER chapters — a structural prior that prevents most spurious edges.

Text for each chapter is pulled directly from the source PDF via PyMuPDF
(same approach extract_chapters.py uses for headings) rather than round-
tripping through the API — ingestion-worker never talks to MongoDB directly,
but it CAN read the file it already has a local path to.

Job payload keys: doc_id, college_id, dept_id, subject_id, dept_name,
college_type, file_path, chapters, callback_url
"""
import json
import logging
import os
import re
from datetime import datetime
from uuid import uuid4

import anthropic
import fitz
import httpx

fitz.TOOLS.mupdf_display_errors(False)

logger = logging.getLogger(__name__)

CONCEPT_GRAPH_MODEL = os.environ.get("CONCEPT_GRAPH_MODEL", "claude-sonnet-4-6")
CONCEPT_GRAPH_MAX_TOKENS = int(os.environ.get("CONCEPT_GRAPH_MAX_TOKENS", "4096"))
CONCEPT_EXTRACT_MAX_CHARS = int(os.environ.get("CONCEPT_EXTRACT_MAX_CHARS", "60000"))
CONCEPT_MIN_PER_CHAPTER = int(os.environ.get("CONCEPT_MIN_PER_CHAPTER", "5"))
CONCEPT_MAX_PER_CHAPTER = int(os.environ.get("CONCEPT_MAX_PER_CHAPTER", "15"))

# USD / 1M tokens — published Claude Sonnet rates. Kept file-local (same
# pattern as contextualiser.py) since this is the only Sonnet-model cost
# calculation in the ingestion worker.
_SONNET_INPUT_COST_PER_1M = 3.00
_SONNET_OUTPUT_COST_PER_1M = 15.00

_VALID_CONCEPT_TYPES = {
    "process_mechanism", "structure_anatomy", "law_relationship",
    "classification", "procedure_calculation", "causal_chain", "definition",
}
_VALID_BLOOM_LEVELS = {"remember", "understand", "apply", "analyse"}

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


CONCEPT_EXTRACTION_PROMPT = """You are building a concept dependency graph for a
{dept_name} textbook used in an Indian {college_type} college.

Chapter {chapter_index}: "{chapter_title}" (pages {start_page}-{end_page})

<chapter_content>
{chapter_text}
</chapter_content>

Concepts already extracted from EARLIER chapters (available as prerequisites):
{earlier_concepts}

Extract the teachable concepts introduced in THIS chapter ({min_count}-{max_count} of
them — prefer substantive teachable units over trivial definitions). For each,
return an object with these exact keys:

{{
  "canonical_name": "Frank-Starling law",
  "aliases": ["Starling's law of the heart", "length-tension relationship"],
  "concept_type": "law_relationship",
  "one_line_definition": "Force of cardiac contraction is proportional to initial fibre length",
  "prerequisites": ["Sarcomere actin-myosin overlap", "Preload"],
  "bloom_ceiling": "analyse",
  "difficulty_rating": 0.72,
  "is_examinable": true
}}

Rules:
- concept_type must be exactly one of: process_mechanism | structure_anatomy |
  law_relationship | classification | procedure_calculation | causal_chain | definition
- prerequisites MUST be drawn verbatim from the earlier-concepts list provided
  above, or from a canonical_name introduced earlier in THIS same array. Never
  forward-reference a concept that appears later in the array or in a later chapter.
- bloom_ceiling must be exactly one of: remember | understand | apply | analyse
- difficulty_rating is a number from 0.0 to 1.0 — your estimate of how hard
  students find this concept.

Return a JSON array only, no prose, no markdown fences."""


def _strip_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _extract_chapter_text(doc: fitz.Document, start_page: int, end_page: int) -> str:
    """1-based inclusive page range, as stored on the chapter map."""
    parts = []
    for page_num in range(max(1, start_page), min(len(doc), end_page) + 1):
        parts.append(doc[page_num - 1].get_text())
    return "\n".join(parts)[:CONCEPT_EXTRACT_MAX_CHARS]


def _extract_chapter_concepts(
    chapter: dict,
    chapter_text: str,
    earlier_concepts: list[dict],
    dept_name: str,
    college_type: str,
) -> tuple[list[dict], float]:
    if not chapter_text.strip():
        return [], 0.0

    earlier_names = [c["canonical_name"] for c in earlier_concepts]
    prompt = CONCEPT_EXTRACTION_PROMPT.format(
        dept_name=dept_name or "the department",
        college_type=college_type or "engineering",
        chapter_index=chapter["chapter_index"],
        chapter_title=chapter["title"],
        start_page=chapter["start_page"],
        end_page=chapter["end_page"],
        chapter_text=chapter_text,
        earlier_concepts="\n".join(f"- {n}" for n in earlier_names[-120:]) or "(none — this is the first chapter)",
        min_count=CONCEPT_MIN_PER_CHAPTER,
        max_count=CONCEPT_MAX_PER_CHAPTER,
    )

    cost_usd = 0.0
    try:
        response = _get_client().messages.create(
            model=CONCEPT_GRAPH_MODEL,
            max_tokens=CONCEPT_GRAPH_MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        cost_usd = (
            response.usage.input_tokens * _SONNET_INPUT_COST_PER_1M
            + response.usage.output_tokens * _SONNET_OUTPUT_COST_PER_1M
        ) / 1_000_000
        raw = _strip_fences(response.content[0].text)
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            return [], cost_usd
    except Exception:
        logger.exception(
            "Concept extraction failed for chapter %d — skipping this chapter",
            chapter["chapter_index"],
        )
        return [], cost_usd

    concepts = []
    for item in parsed:
        if not isinstance(item, dict) or not item.get("canonical_name"):
            continue
        concept_type = item.get("concept_type")
        if concept_type not in _VALID_CONCEPT_TYPES:
            concept_type = "definition"
        bloom_ceiling = item.get("bloom_ceiling")
        if bloom_ceiling not in _VALID_BLOOM_LEVELS:
            bloom_ceiling = "understand"

        try:
            difficulty = float(item.get("difficulty_rating", 0.5))
        except (TypeError, ValueError):
            difficulty = 0.5
        difficulty = max(0.0, min(1.0, difficulty))

        concepts.append({
            "_id": str(uuid4()),
            "canonical_name": str(item["canonical_name"]).strip(),
            "aliases": [str(a) for a in item.get("aliases", []) if a],
            "concept_type": concept_type,
            "one_line_definition": str(item.get("one_line_definition", "")).strip(),
            "chapter_index": chapter["chapter_index"],
            "source_pages": list(range(chapter["start_page"], chapter["end_page"] + 1)),
            "prerequisite_names_raw": [str(p).strip() for p in item.get("prerequisites", []) if p],
            "prerequisite_ids": [],
            "prerequisite_names": [],
            "bloom_ceiling": bloom_ceiling,
            "difficulty_rating": difficulty,
            "is_examinable": bool(item.get("is_examinable", True)),
            "pyq_frequency": 0,
            "extraction_method": "llm_chapter_pass",
            "reviewed_by_faculty": False,
        })
    return concepts, cost_usd


def resolve_prerequisite_ids(concepts: list[dict]) -> list[dict]:
    """Resolve prerequisite name strings (verbatim or case-insensitive match
    against canonical_name/aliases) to concept ids. Only concepts appearing
    EARLIER in the list (earlier chapters, or earlier within the same
    chapter — concepts are already in chapter/extraction order) are eligible
    matches: the lookup map is built incrementally in a single forward pass,
    registering each concept only AFTER resolving its own prerequisites. The
    previous two-pass approach (build the whole-list name map first, then
    resolve everything against it) let a later chapter's same-named concept
    silently overwrite an earlier chapter's map entry, so a concept's
    prerequisite could resolve to a LATER chapter's node — exactly the
    forward-reference the extraction prompt's rule is meant to forbid, and
    cycle detection wouldn't necessarily catch it since it need not form a
    cycle. Unresolvable names are dropped rather than left dangling."""
    by_name: dict[str, dict] = {}
    for c in concepts:
        ids, names = [], []
        for raw_name in c.get("prerequisite_names_raw", []):
            match = by_name.get(raw_name.lower())
            if match and match["_id"] != c["_id"]:
                ids.append(match["_id"])
                names.append(match["canonical_name"])
        c["prerequisite_ids"] = ids
        c["prerequisite_names"] = names
        c.pop("prerequisite_names_raw", None)

        # Register this concept for later concepts to reference, only now
        # that its own prerequisites are already resolved.
        by_name.setdefault(c["canonical_name"].lower(), c)
        for alias in c["aliases"]:
            by_name.setdefault(alias.lower(), c)

    return concepts


def detect_cycles(concepts: list[dict]) -> list[list[str]]:
    """Standard DFS cycle detection over the prerequisite edges."""
    graph = {c["_id"]: c.get("prerequisite_ids", []) for c in concepts}
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {cid: WHITE for cid in graph}
    cycles: list[list[str]] = []

    def dfs(node: str, path: list[str]) -> None:
        colour[node] = GREY
        for nxt in graph.get(node, []):
            if nxt not in colour:
                continue
            if colour[nxt] == GREY:
                cycles.append(path[path.index(nxt):] + [nxt])
            elif colour[nxt] == WHITE:
                dfs(nxt, path + [nxt])
        colour[node] = BLACK

    for cid in list(graph.keys()):
        if colour[cid] == WHITE:
            dfs(cid, [cid])
    return cycles


def break_cycles(concepts: list[dict], cycles: list[list[str]]) -> list[dict]:
    """Break each cycle by removing the edge whose target appears in a LATER
    (or equal) chapter than its source — that edge is almost certainly the
    erroneous one, since the extraction prompt forbids forward references."""
    by_id = {c["_id"]: c for c in concepts}
    for cycle in cycles:
        edges = list(zip(cycle, cycle[1:] + [cycle[0]]))
        edges = [(s, t) for s, t in edges if s in by_id and t in by_id]
        if not edges:
            continue
        src, tgt = max(edges, key=lambda e: by_id[e[1]]["chapter_index"] - by_id[e[0]]["chapter_index"])
        by_id[src]["prerequisite_ids"] = [p for p in by_id[src]["prerequisite_ids"] if p != tgt]
        by_id[src]["prerequisite_names"] = [by_id[p]["canonical_name"] for p in by_id[src]["prerequisite_ids"]]
    return list(by_id.values())


async def run_extract_concept_graph(job_data: dict) -> None:
    doc_id       = job_data["doc_id"]
    college_id   = job_data["college_id"]
    dept_id      = job_data["dept_id"]
    subject_id   = job_data.get("subject_id")
    dept_name    = job_data.get("dept_name", "")
    college_type = job_data.get("college_type", "")
    file_path    = job_data["file_path"]
    chapters     = sorted(job_data["chapters"], key=lambda c: c["chapter_index"])
    callback_url = job_data["callback_url"]

    logger.info("extract_concept_graph: start doc_id=%s chapters=%d", doc_id, len(chapters))

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Source PDF not found: {file_path}")

    all_concepts: list[dict] = []
    total_cost_usd = 0.0

    # Context-managed so a page-level exception mid-loop (malformed/corrupt
    # PDF) still closes the document instead of leaking the MuPDF file
    # handle in this long-running worker process.
    with fitz.open(file_path) as doc:
        for chapter in chapters:
            chapter_text = _extract_chapter_text(doc, chapter["start_page"], chapter["end_page"])
            chapter_concepts, chapter_cost = _extract_chapter_concepts(chapter, chapter_text, all_concepts, dept_name, college_type)
            all_concepts.extend(chapter_concepts)
            total_cost_usd += chapter_cost

    all_concepts = resolve_prerequisite_ids(all_concepts)

    cycles = detect_cycles(all_concepts)
    if cycles:
        logger.warning("extract_concept_graph: %d cycle(s) detected, breaking", len(cycles))
        all_concepts = break_cycles(all_concepts, cycles)

    for c in all_concepts:
        c["doc_id"] = doc_id
        c["college_id"] = college_id
        c["dept_id"] = dept_id
        c["subject_id"] = subject_id
        c["created_at"] = datetime.utcnow().isoformat()

    payload = {
        "status": "completed",
        "concept_count": len(all_concepts),
        "concepts": all_concepts,
        "concept_graph_extraction_cost_usd": round(total_cost_usd, 6),
    }

    await _post_callback(callback_url, college_id, payload)
    logger.info("extract_concept_graph: done doc_id=%s concepts=%d", doc_id, len(all_concepts))


async def _post_callback(url: str, college_id: str, payload: dict) -> None:
    headers = {
        "x-internal-secret": os.environ["API_INTERNAL_SECRET"],
        "x-college-id": college_id,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()


async def post_concept_graph_failure(url: str, college_id: str, error: str) -> None:
    try:
        await _post_callback(url, college_id, {"status": "failed", "error": error})
    except Exception:
        logger.exception("Failed to POST concept graph extraction failure callback")
