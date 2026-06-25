"""
PDF parser using PyMuPDF.
Falls back to Tesseract OCR when extracted text is sparse (avg < 100 chars/page).
"""
import logging
import os
from concurrent.futures import ProcessPoolExecutor, as_completed

import fitz  # PyMuPDF
import pytesseract
from PIL import Image

logger = logging.getLogger(__name__)

OCR_TRIGGER_CHARS_PER_PAGE = 100
OCR_DPI = 200


def _ocr_page(path: str, page_index: int) -> str:
    doc = fitz.open(path)
    page = doc[page_index]
    pix = page.get_pixmap(dpi=OCR_DPI)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    text = pytesseract.image_to_string(img, lang="eng")
    doc.close()
    return text


def parse_pdf(path: str) -> tuple[list[str], bool]:
    """
    Returns (pages: list[str], ocr_used: bool).
    Each element in pages is the text of one page.
    """
    doc = fitz.open(path)
    pages: list[str] = [page.get_text() for page in doc]
    page_count = len(doc)
    doc.close()

    avg_chars = sum(len(p) for p in pages) / max(page_count, 1)
    if avg_chars >= OCR_TRIGGER_CHARS_PER_PAGE:
        return pages, False

    # OCR fallback — page-level parallelism across CPU cores
    logger.info(f"OCR fallback triggered: {page_count} pages, path={path}")
    workers = max(1, os.cpu_count() or 1)
    ocr_pages: list[str] = [""] * page_count
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_ocr_page, path, i): i for i in range(page_count)}
        done_count = 0
        for future in as_completed(futures):
            i = futures[future]
            ocr_pages[i] = future.result()
            done_count += 1
            if done_count % 10 == 0 or done_count == page_count:
                logger.info(f"OCR progress: {done_count}/{page_count} pages, path={path}")

    return ocr_pages, True
