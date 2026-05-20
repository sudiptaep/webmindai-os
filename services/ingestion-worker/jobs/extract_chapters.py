"""
Chapter extraction job — F-13-A.

Extracts chapter structure from a PDF using:
  1. PDF bookmark/outline tree  (preferred, confidence 0.95)
  2. Heuristic heading detection (fallback,  confidence 0.70)
  3. Single "Full Book" pseudo-chapter if nothing found (confidence 0.0)

After building the chapter list, queries Pinecone to populate chunk_ids
for each chapter's page range, then POSTs the result to the API webhook.

Job payload keys: doc_id, college_id, dept_id, file_path, callback_url
"""
import logging
import os
import re

import fitz  # PyMuPDF — already in requirements via pymupdf
import httpx
from pinecone import Pinecone

fitz.TOOLS.mupdf_display_errors(False)  # suppress non-fatal MuPDF warnings

logger = logging.getLogger(__name__)

PINECONE_BATCH = 500   # max top_k per metadata-only Pinecone query
HEURISTIC_SCAN_PAGES = int(os.environ.get("CHAPTER_HEURISTIC_SCAN_PAGES", "600"))
MIN_CHAPTERS = int(os.environ.get("CHAPTER_EXTRACTION_MIN_CHAPTERS", "3"))

_pc: Pinecone | None = None


def _get_pinecone() -> Pinecone:
    global _pc
    if _pc is None:
        _pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
    return _pc


# ── Chapter extraction ────────────────────────────────────────────────────────

def _blank_chapter(index: int, title: str, start: int, end: int) -> dict:
    return {
        "chapter_index":       index,
        "title":               title,
        "subtitle":            "",
        "start_page":          start,
        "end_page":            end,
        "page_count":          end - start + 1,
        "chunk_ids":           [],
        "chunk_count":         0,
        "pyq_count":           0,
        "pyq_years":           [],
        "pyq_question_ids":    [],
        "pyq_coverage_score":  0.0,
        "avg_class_score":     None,
        "study_session_count": 0,
    }


def _extract_from_bookmarks(doc: fitz.Document) -> list[dict]:
    toc = doc.get_toc()
    if not toc or len(toc) < MIN_CHAPTERS:
        return []

    total_pages = len(doc)
    top_level = [(title.strip(), page) for level, title, page in toc if level == 1]
    if len(top_level) < MIN_CHAPTERS:
        return []

    chapters = []
    for i, (title, start_page) in enumerate(top_level):
        end_page = top_level[i + 1][1] - 1 if i < len(top_level) - 1 else total_pages
        # Guard against malformed TOC entries where end < start
        if end_page < start_page:
            end_page = start_page
        chapters.append(_blank_chapter(i + 1, title, start_page, end_page))

    return chapters


# Chapter-level patterns only — no sections/subsections
_CHAPTER_PATTERNS = [
    re.compile(r"^chapter\s+\d+",                         re.IGNORECASE),
    re.compile(r"^unit\s+\d+",                            re.IGNORECASE),
    re.compile(r"^(?:module|topic|part|lecture)\s+\d+",   re.IGNORECASE),
    # "1. Introduction" but NOT "1.3 Sub-topic" or all-caps abbreviations
    re.compile(r"^([1-9]|[1-2][0-9])\.\s+[A-Z][a-z]"),
]

MIN_CHAPTER_PAGES = int(os.environ.get("CHAPTER_MIN_PAGES", "2"))


def _extract_heuristic(doc: fitz.Document) -> list[dict]:
    total_pages = len(doc)
    # Each entry: (page_num_1based, title, font_size)
    chapter_starts: list[tuple[int, str, float]] = []

    for page_num in range(min(total_pages, HEURISTIC_SCAN_PAGES)):
        page = doc[page_num]
        page_height = page.rect.height
        blocks = page.get_text("dict")["blocks"]

        # Best candidate on this page (largest matching heading in top 40%)
        best: tuple[float, str] | None = None

        for block in blocks:
            # Skip anything below the top 40% of the page
            bbox = block.get("bbox", [0, 0, 0, page_height])
            if bbox[1] > page_height * 0.40:
                continue

            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span["text"].strip()
                    if not text or len(text) < 4 or len(text) > 80:
                        continue
                    size: float = span.get("size", 0)
                    bold: bool  = bool(span.get("flags", 0) & 16)

                    # Require bold ≥ 14pt OR any span ≥ 20pt
                    if not ((bold and size >= 14) or size >= 20):
                        continue

                    for pattern in _CHAPTER_PATTERNS:
                        if pattern.match(text):
                            if best is None or size > best[0]:
                                best = (size, text)
                            break

        if best is None:
            continue

        # Enforce minimum page gap between chapters
        if chapter_starts and (page_num + 1) - chapter_starts[-1][0] < MIN_CHAPTER_PAGES:
            # Same or adjacent page — keep the larger heading
            if best[0] > chapter_starts[-1][2]:
                chapter_starts[-1] = (page_num + 1, best[1], best[0])
        else:
            chapter_starts.append((page_num + 1, best[1], best[0]))

    if len(chapter_starts) < MIN_CHAPTERS:
        return []

    chapters = []
    for i, (start_page, title, _) in enumerate(chapter_starts):
        end_page = chapter_starts[i + 1][0] - 1 if i < len(chapter_starts) - 1 else total_pages
        if end_page < start_page:
            end_page = start_page
        chapters.append(_blank_chapter(i + 1, title, start_page, end_page))

    return chapters


def _populate_chunk_ids(chapters: list[dict], doc_id: str, college_id: str, dept_id: str) -> list[dict]:
    """
    For each chapter, fetch Pinecone vector IDs whose page_num falls within
    [start_page, end_page]. Uses a zero-vector query with metadata filter.
    """
    namespace = f"c_{college_id}_d_{dept_id}"
    index = _get_pinecone().Index(os.environ["PINECONE_INDEX_NAME"])
    zero_vec = [0.0] * 1536

    for ch in chapters:
        try:
            result = index.query(
                vector=zero_vec,
                filter={
                    "doc_id":        {"$eq": doc_id},
                    "section_index": {"$gte": ch["start_page"] - 1, "$lte": ch["end_page"] - 1},
                },
                top_k=PINECONE_BATCH,
                namespace=namespace,
                include_metadata=False,
            )
            ch["chunk_ids"]   = [m.id for m in result.matches]
            ch["chunk_count"] = len(result.matches)
        except Exception:
            logger.exception(
                "Pinecone chunk-ID query failed for chapter %d (doc_id=%s)",
                ch["chapter_index"], doc_id,
            )
            # Non-fatal — chunk_ids stays empty; can be repopulated later

    return chapters


# ── Job entry point ───────────────────────────────────────────────────────────

async def run_extract_chapters(job_data: dict) -> None:
    """
    Main entry point called by worker.py.
    Raises on unrecoverable error; worker handles callback on exception.
    """
    doc_id      = job_data["doc_id"]
    college_id  = job_data["college_id"]
    dept_id     = job_data["dept_id"]
    file_path   = job_data["file_path"]
    callback_url = job_data["callback_url"]

    logger.info("extract_chapters: start doc_id=%s file=%s", doc_id, file_path)

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Source PDF not found: {file_path}")

    doc = fitz.open(file_path)
    total_pages = len(doc)

    # Method 1 — bookmarks
    chapters = _extract_from_bookmarks(doc)
    if chapters:
        method     = "pdf_bookmarks"
        confidence = 0.95
        logger.info("extract_chapters: bookmarks found %d chapters", len(chapters))
    else:
        # Method 2 — heuristic
        chapters = _extract_heuristic(doc)
        if chapters:
            method     = "heuristic"
            confidence = 0.70
            logger.info("extract_chapters: heuristic found %d chapters", len(chapters))
        else:
            # Fallback — single pseudo-chapter
            chapters   = [_blank_chapter(1, "Full Book", 1, total_pages)]
            method     = "heuristic"
            confidence = 0.0
            logger.info("extract_chapters: no chapters detected — using Full Book fallback")

    doc.close()

    # Populate chunk_ids from Pinecone (best-effort)
    chapters = _populate_chunk_ids(chapters, doc_id, college_id, dept_id)

    payload = {
        "status":            "completed",
        "chapter_count":     len(chapters),
        "extraction_method": method,
        "confidence_score":  confidence,
        "chapters":          chapters,
    }

    await _post_callback(callback_url, college_id, payload)
    logger.info("extract_chapters: done doc_id=%s chapters=%d method=%s", doc_id, len(chapters), method)


async def _post_callback(url: str, college_id: str, payload: dict) -> None:
    headers = {
        "x-internal-secret": os.environ["API_INTERNAL_SECRET"],
        "x-college-id":      college_id,
        "Content-Type":      "application/json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()


async def post_chapter_failure(url: str, college_id: str, error: str) -> None:
    try:
        await _post_callback(url, college_id, {"status": "failed", "error": error})
    except Exception:
        logger.exception("Failed to POST chapter extraction failure callback")
