"""
PDF parser using PyMuPDF.
Falls back to Tesseract OCR when extracted text is sparse (avg < 100 chars/page).
"""
import logging
import os
from concurrent.futures import ProcessPoolExecutor, as_completed

import fitz  # PyMuPDF
import pytesseract
from pytesseract import Output
from PIL import Image

logger = logging.getLogger(__name__)

OCR_TRIGGER_CHARS_PER_PAGE = 100
OCR_DPI = 200


def _ocr_page(path: str, page_index: int) -> dict:
    """Returns {"text": str, "confidence": float, "low_confidence_ratio": float}.

    Uses image_to_data (per-word confidence) instead of image_to_string so the
    quality score can reflect the actual scan quality, not a flat assumption.
    """
    doc = fitz.open(path)
    page = doc[page_index]
    pix = page.get_pixmap(dpi=OCR_DPI)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    data = pytesseract.image_to_data(img, lang="eng", output_type=Output.DICT)
    doc.close()

    words = [
        (text, int(conf)) for text, conf in zip(data["text"], data["conf"])
        if text.strip() and int(conf) > -1
    ]
    confidence = sum(c for _, c in words) / len(words) if words else 0.0
    low_confidence_ratio = (
        sum(1 for _, c in words if c < 60) / len(words) if words else 0.0
    )

    return {
        "text": " ".join(t for t, _ in words),
        "confidence": confidence,
        "low_confidence_ratio": low_confidence_ratio,
    }


def parse_pdf(path: str) -> tuple[list[str], bool, list[dict | None]]:
    """
    Returns (pages: list[str], ocr_used: bool, page_ocr_data: list[dict | None]).
    Each element in pages is the text of one page.
    page_ocr_data[i] is {"confidence": float, "low_confidence_ratio": float} for
    pages that went through OCR, else None (no OCR needed for that page).
    """
    doc = fitz.open(path)
    pages: list[str] = [page.get_text() for page in doc]
    page_count = len(doc)
    doc.close()

    avg_chars = sum(len(p) for p in pages) / max(page_count, 1)
    if avg_chars >= OCR_TRIGGER_CHARS_PER_PAGE:
        return pages, False, [None] * page_count

    # OCR fallback — page-level parallelism across CPU cores
    logger.info(f"OCR fallback triggered: {page_count} pages, path={path}")
    workers = max(1, os.cpu_count() or 1)
    ocr_pages: list[str] = [""] * page_count
    page_ocr_data: list[dict | None] = [None] * page_count
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_ocr_page, path, i): i for i in range(page_count)}
        done_count = 0
        for future in as_completed(futures):
            i = futures[future]
            result = future.result()
            ocr_pages[i] = result["text"]
            page_ocr_data[i] = {
                "confidence": result["confidence"],
                "low_confidence_ratio": result["low_confidence_ratio"],
            }
            done_count += 1
            if done_count % 10 == 0 or done_count == page_count:
                logger.info(f"OCR progress: {done_count}/{page_count} pages, path={path}")

    return ocr_pages, True, page_ocr_data
