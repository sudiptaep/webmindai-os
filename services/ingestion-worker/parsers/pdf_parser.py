"""
PDF parser using PyMuPDF.
Falls back to Tesseract OCR when extracted text is sparse (avg < 100 chars/page).
"""
import fitz  # PyMuPDF
import pytesseract
from PIL import Image


OCR_TRIGGER_CHARS_PER_PAGE = 100
OCR_DPI = 200


def parse_pdf(path: str) -> tuple[list[str], bool]:
    """
    Returns (pages: list[str], ocr_used: bool).
    Each element in pages is the text of one page.
    """
    doc = fitz.open(path)
    pages: list[str] = [page.get_text() for page in doc]

    avg_chars = sum(len(p) for p in pages) / max(len(pages), 1)
    if avg_chars >= OCR_TRIGGER_CHARS_PER_PAGE:
        doc.close()
        return pages, False

    # OCR fallback
    ocr_pages: list[str] = []
    for page in doc:
        pix = page.get_pixmap(dpi=OCR_DPI)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        text = pytesseract.image_to_string(img, lang="eng")
        ocr_pages.append(text)

    doc.close()
    return ocr_pages, True
