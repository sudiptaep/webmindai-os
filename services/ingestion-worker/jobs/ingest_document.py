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

from chunker import chunk_texts, compute_quality_score
from embedder import embed_chunks
from vector_store import upsert_chunks
from parsers.pdf_parser import parse_pdf
from parsers.pptx_parser import parse_pptx
from parsers.docx_parser import parse_docx
from parsers.audio_parser import parse_audio_verbose
from jobs.generate_thumbnail import generate_thumbnail

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
    if file_type in ("mp4", "mkv", "mp3", "m4a"):
        sections, timing, ocr_used = parse_audio_verbose(file_path, file_type)
    elif file_type == "pdf":
        sections, ocr_used = parse_pdf(file_path)
    elif file_type == "pptx":
        sections, ocr_used = parse_pptx(file_path)
    elif file_type == "docx":
        from parsers.docx_parser import parse_docx
        sections, ocr_used = parse_docx(file_path)
    else:
        raise ValueError(f"Unsupported file type: {file_type}")

    logger.info("Parsed %d sections (ocr=%s)", len(sections), ocr_used)

    if not sections:
        raise ValueError("Parser returned no text content")

    # 3. Chunk
    base_metadata = {
        "doc_id": doc_id,
        "college_id": college_id,
        "dept_id": dept_id,
        "subject_id": subject_id or "",
        "file_type": file_type,
        "academic_year": academic_year,
    }
    chunks = chunk_texts(sections, base_metadata)
    logger.info("Created %d chunks", len(chunks))

    if not chunks:
        raise ValueError("No chunks produced after splitting")

    # 4. Quality score
    quality_score = compute_quality_score(chunks, ocr_used)

    # 5. Embed
    chunks = embed_chunks(chunks)
    logger.info("Embedded %d chunks", len(chunks))

    # 6. Upsert to Pinecone
    upserted = upsert_chunks(chunks, college_id, dept_id, doc_id)
    logger.info("Upserted %d vectors to Pinecone", upserted)

    # 7a. Text cache — one entry per section (page / slide / segment)
    tc_path = _text_cache_path(college_id, doc_id)
    cache_pages = [
        {"page_num": i + 1, "text": text, "ocr_confidence": None}
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
        "quality_score": quality_score,
        "ocr_used": ocr_used,
        "text_cache_path": tc_path,
        "thumbnail_path": th_path,
        "transcript_path": tr_path,
        "page_count": page_count,
        "slide_count": slide_count,
        "duration_seconds": duration_seconds,
    }
