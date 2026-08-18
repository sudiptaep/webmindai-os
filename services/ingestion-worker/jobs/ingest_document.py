"""
Main ingestion pipeline orchestrator.

Pipeline:
  1. Resolve source file (file_path from job_data; fallback to STORAGE_ROOT/r2_key)
  2. Parse (PDF/PPTX/DOCX/audio) → list[str] sections + optional timing
  3. Chunk (512 tokens, 50 overlap)
  4. Compute quality score
  5. Embed (OpenAI text-embedding-3-small)
  6. Upsert to Pinecone namespace c_{college_id}_d_{dept_id}
  7. Write text cache / transcript / thumbnail
  8. POST callback to Fastify
"""
import json
import logging
import os

import httpx

from hierarchical_chunker import build_hierarchical_chunks
from contextualiser import contextualise_children, CONTEXTUALISER_ENABLED, CONTEXTUALISER_VERSION
from embedder import embed_chunks
from bm25_encoder import has_encoder, encode_document
from vector_store import upsert_chunks, get_doc_vector_ids, delete_vector_ids
from parsers.pdf_parser import parse_pdf
from parsers.pptx_parser import parse_pptx
from parsers.docx_parser import parse_docx
from parsers.audio_parser import parse_audio_verbose
from jobs.generate_thumbnail import generate_thumbnail
from quality.compute_quality_score import compute_document_quality

logger = logging.getLogger(__name__)

STORAGE_ROOT = (
    os.environ.get("STORAGE_ROOT")
    or os.environ.get("UPLOADS_DIR")
    or os.path.join(os.getcwd(), "uploads")
)


def _resolve_file_path(job_data: dict) -> str:
    if job_data.get("file_path"):
        return job_data["file_path"]
    return os.path.join(STORAGE_ROOT, job_data["r2_key"])


def _text_cache_path(college_id: str, doc_id: str) -> str:
    return os.path.join(STORAGE_ROOT, "colleges", college_id, "text_cache", f"{doc_id}.json")


def _transcript_path(college_id: str, doc_id: str) -> str:
    return os.path.join(STORAGE_ROOT, "colleges", college_id, "transcripts", f"{doc_id}.json")


def _thumbnail_path(college_id: str, doc_id: str) -> str:
    return os.path.join(STORAGE_ROOT, "colleges", college_id, "thumbnails", f"{doc_id}.jpg")


def _write_json(path: str, data: object) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)


async def post_callback(
    callback_url: str,
    payload: dict,
    college_id: str,
) -> None:
    headers = {
        "x-internal-secret": os.environ["API_INTERNAL_SECRET"],
        "x-college-id": college_id,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(callback_url, json=payload, headers=headers)
        resp.raise_for_status()


PARENT_BULK_SAVE_BATCH = 200


async def post_parents_bulk_save(
    bulk_save_url: str,
    parents: list[dict],
    college_id: str,
) -> None:
    """POSTs parent_chunks in batches — large textbooks can produce 1000+ parents."""
    headers = {
        "x-internal-secret": os.environ["API_INTERNAL_SECRET"],
        "x-college-id": college_id,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        for i in range(0, len(parents), PARENT_BULK_SAVE_BATCH):
            batch = parents[i : i + PARENT_BULK_SAVE_BATCH]
            resp = await client.post(bulk_save_url, json={"parents": batch}, headers=headers)
            resp.raise_for_status()


def run_pipeline(job_data: dict) -> dict:
    """
    Execute full ingestion pipeline for one job.
    Returns result dict (chunk_count, quality_score, ocr_used, + F-11 metadata).
    Raises on failure — caller handles callback.
    """
    doc_id: str = job_data["doc_id"]
    college_id: str = job_data["college_id"]
    dept_id: str = job_data["dept_id"]
    subject_id: str | None = job_data.get("subject_id")
    r2_key: str = job_data["r2_key"]
    file_type: str = job_data["file_type"]
    academic_year: str = job_data["academic_year"]

    file_path = _resolve_file_path(job_data)
    logger.info("Starting ingestion: doc_id=%s file_type=%s path=%s", doc_id, file_type, file_path)

    # 2. Parse
    timing: list[dict] = []
    page_ocr_data: list[dict | None]
    if file_type in ("mp4", "mkv", "mp3", "m4a"):
        sections, timing, ocr_used = parse_audio_verbose(file_path, file_type)
        page_ocr_data = [None] * len(sections)
    elif file_type == "pdf":
        sections, ocr_used, page_ocr_data = parse_pdf(file_path)
    elif file_type == "pptx":
        sections, ocr_used = parse_pptx(file_path)
        page_ocr_data = [None] * len(sections)
    elif file_type == "docx":
        from parsers.docx_parser import parse_docx
        sections, ocr_used = parse_docx(file_path)
        page_ocr_data = [None] * len(sections)
    else:
        raise ValueError(f"Unsupported file type: {file_type}")

    logger.info("Parsed %d sections (ocr=%s)", len(sections), ocr_used)

    if not sections:
        raise ValueError("Parser returned no text content")

    # 3a. Multi-signal quality scoring (F-18-A) — also runs hyphenation repair
    # and boilerplate stripping, so `sections` is replaced with the cleaned text.
    quality_result = compute_document_quality(sections, ocr_used, page_ocr_data)
    sections = quality_result["cleaned_pages"]

    # 3. Hierarchical chunk (F-19-B) — parents (~1400 tok, stored in Mongo, never
    # embedded) + children (~350 tok, embedded/upserted, linked via parent_chunk_id)
    base_metadata = {
        "doc_id": doc_id,
        "college_id": college_id,
        "dept_id": dept_id,
        "subject_id": subject_id or "",
        "file_type": file_type,
        "academic_year": academic_year,
    }
    hierarchy = build_hierarchical_chunks(sections, base_metadata)
    parents = hierarchy["parents"]
    chunks = hierarchy["children"]
    logger.info("Created %d parent chunks, %d child chunks", len(parents), len(chunks))

    if not chunks:
        raise ValueError("No chunks produced after splitting")

    # 4. Contextual enrichment (F-19-A) — situates each child within the
    # document before embedding. embedding_text (prefix + text) is what gets
    # embedded; original_text (unprefixed) is what the LLM sees at generation.
    whole_document_text = "\n\n".join(sections)
    chunks, contextualiser_cost_usd = contextualise_children(
        chunks,
        whole_document_text=whole_document_text,
        file_type=file_type,
        dept_name=job_data.get("dept_name") or "",
        college_type=job_data.get("college_type") or "",
    )
    logger.info(
        "Contextualised %d chunks (enabled=%s, cost=$%.4f)",
        len(chunks), CONTEXTUALISER_ENABLED, contextualiser_cost_usd,
    )

    # 5. Embed — embeds embedding_text (prefix + original), not raw chunk text
    chunks = embed_chunks(chunks, text_key="embedding_text")
    logger.info("Embedded %d chunks", len(chunks))

    # 5b. Sparse-encode (F-19-F) — only if this department already has a fitted
    # BM25 encoder (admin-triggered, corpus-wide fit; see bm25_encoder.py). A
    # brand-new department has none yet, so chunks upsert dense-only until the
    # first fit runs — hybrid search degrades gracefully, never blocks ingestion.
    if has_encoder(college_id, dept_id):
        for chunk in chunks:
            sparse = encode_document(college_id, dept_id, chunk["embedding_text"])
            if sparse:
                chunk["sparse_values"] = sparse
        logger.info("Sparse-encoded %d chunks", len(chunks))

    # 6. Upsert to Pinecone. On a re-ingest (F-19 Step 9), the new pipeline can
    # produce fewer chunks than whatever indexed this doc before (e.g. the old
    # flat chunker vs. the new hierarchical one) — capture the pre-upsert ID
    # set so any now-orphaned trailing vectors can be cleaned up AFTER the new
    # ones are confirmed upserted, never before. Matching IDs (same doc_id,
    # same chunk_index) are simply overwritten in place by the upsert itself,
    # so there is no window where a chunk's content is missing.
    pre_upsert_ids = get_doc_vector_ids(college_id, dept_id, doc_id)
    upserted = upsert_chunks(chunks, college_id, dept_id, doc_id)
    logger.info("Upserted %d vectors to Pinecone", upserted)

    new_ids = {f"{doc_id}_{i}" for i in range(len(chunks))}
    stale_ids = pre_upsert_ids - new_ids
    if stale_ids:
        delete_vector_ids(college_id, dept_id, stale_ids)
        logger.info("Deleted %d stale vectors left over from a previous ingest", len(stale_ids))

    # 7a. Text cache — one entry per section (page / slide / segment).
    # Includes real per-page OCR confidence so a future re-score (§2.6) can
    # recompute the quality signals without re-running OCR.
    tc_path = _text_cache_path(college_id, doc_id)
    cache_pages = [
        {
            "page_num": i + 1,
            "text": text,
            "ocr_confidence": (page_ocr_data[i]["confidence"] if i < len(page_ocr_data) and page_ocr_data[i] else None),
        }
        for i, text in enumerate(sections)
    ]
    _write_json(tc_path, {"total_pages": len(sections), "pages": cache_pages})
    logger.info("Wrote text cache: %s", tc_path)

    # 7b. Transcript (audio/video only)
    tr_path: str | None = None
    duration_seconds: float | None = None
    if timing:
        tr_path = _transcript_path(college_id, doc_id)
        _write_json(tr_path, timing)
        duration_seconds = max((seg["end_sec"] for seg in timing), default=None)
        logger.info("Wrote transcript: %s", tr_path)

    # 7c. Thumbnail
    th_path: str | None = None
    th_result = generate_thumbnail(file_path, file_type, _thumbnail_path(college_id, doc_id))
    if th_result:
        th_path = th_result
        logger.info("Generated thumbnail: %s", th_path)

    # Derive count fields
    page_count: int | None = len(sections) if file_type == "pdf" else None
    slide_count: int | None = len(sections) if file_type == "pptx" else None

    return {
        "chunk_count": len(chunks),
        "parent_chunk_count": len(parents),
        "child_chunk_count": len(chunks),
        "parents": parents,
        "quality_score": quality_result["quality_score"],
        "signal_breakdown": quality_result["signal_breakdown"],
        "quality_formula_version": quality_result["quality_formula_version"],
        "extraction_artifacts_cached": True,
        "ocr_used": ocr_used,
        "text_cache_path": tc_path,
        "thumbnail_path": th_path,
        "transcript_path": tr_path,
        "page_count": page_count,
        "slide_count": slide_count,
        "duration_seconds": duration_seconds,
        "contextualised": CONTEXTUALISER_ENABLED,
        "contextualiser_version": CONTEXTUALISER_VERSION,
        "contextualiser_cost_usd": contextualiser_cost_usd,
    }
