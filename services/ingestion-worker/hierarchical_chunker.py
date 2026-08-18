"""
F-19-B: Small-to-big hierarchical chunking.

Produces two linked layers from a document's page texts:
  parents:  large (~1400 token) sections, stored in MongoDB — never embedded
  children: small (~350 token) chunks, embedded + upserted to Pinecone,
            each linked back to its parent via parent_chunk_id

Only children are embedded/searched. Parents are fetched at retrieval time
(rag.service.ts expandToParents) and are what the LLM actually reads.
"""
import os

from chunker import semantic_chunk, _token_len

CHILD_CHUNK_TOKENS = int(os.environ.get("CHUNK_CHILD_TOKENS", "350"))
CHILD_OVERLAP_TOKENS = int(os.environ.get("CHUNK_CHILD_OVERLAP", "40"))
PARENT_CHUNK_TOKENS = int(os.environ.get("CHUNK_PARENT_TOKENS", "1400"))


def _merge_pages_into_parents(pages: list[str], target_tokens: int) -> list[dict]:
    """
    Greedily merges consecutive pages into parent sections targeting ~target_tokens.
    A page larger than target becomes a parent on its own — it is not split further
    here; the child-level semantic_chunk pass below handles splitting it down.
    """
    parents: list[dict] = []
    page_nums: list[int] = []
    text_parts: list[str] = []
    tokens = 0

    def flush() -> None:
        nonlocal page_nums, text_parts, tokens
        if not text_parts:
            return
        parents.append({
            "text": "\n\n".join(text_parts),
            "page_start": page_nums[0] + 1,  # 1-based, matches existing page_num convention
            "page_end": page_nums[-1] + 1,
            "token_count": tokens,
        })
        page_nums, text_parts, tokens = [], [], 0

    for i, page_text in enumerate(pages):
        if not page_text.strip():
            continue
        page_tokens = _token_len(page_text)

        if tokens > 0 and tokens + page_tokens > target_tokens:
            flush()

        page_nums.append(i)
        text_parts.append(page_text)
        tokens += page_tokens

    flush()
    return parents


def build_hierarchical_chunks(pages: list[str], base_metadata: dict) -> dict:
    """
    base_metadata must include doc_id, college_id, dept_id, subject_id (may be "").
    Returns {"parents": [...], "children": [...]}.
    Children carry the same {"text", "metadata"} shape chunk_texts() produced,
    so downstream embed/upsert code needs no changes.
    """
    parent_sections = _merge_pages_into_parents(pages, PARENT_CHUNK_TOKENS)

    parent_records: list[dict] = []
    children: list[dict] = []

    for parent_idx, parent in enumerate(parent_sections):
        parent_id = f"{base_metadata['doc_id']}_p{parent_idx}"

        child_texts = semantic_chunk(
            parent["text"], target_size=CHILD_CHUNK_TOKENS, overlap=CHILD_OVERLAP_TOKENS
        )
        child_texts = [c for c in child_texts if c.strip()]

        parent_records.append({
            "_id": parent_id,
            "doc_id": base_metadata["doc_id"],
            "college_id": base_metadata["college_id"],
            "dept_id": base_metadata["dept_id"],
            "subject_id": base_metadata.get("subject_id") or None,
            "text": parent["text"],
            "token_count": parent["token_count"],
            "page_start": parent["page_start"],
            "page_end": parent["page_end"],
            "child_chunk_count": len(child_texts),
        })

        for child_text in child_texts:
            children.append({
                "text": child_text,
                "metadata": {
                    **base_metadata,
                    "parent_chunk_id": parent_id,
                    "page_num": parent["page_start"],
                    "chunk_index": len(children),
                },
            })

    return {"parents": parent_records, "children": children}
