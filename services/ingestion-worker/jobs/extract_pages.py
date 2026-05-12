"""
Page/slide extraction worker job.

PDF:  pypdf extracts requested pages → temp PDF written to local temp dir.
PPTX: LibreOffice converts full PPTX → PDF, then pypdf extracts slide pages.
      (Slide N in PPTX = page N in the converted PDF — 1:1 mapping.)

Output file lives at:
  {STORAGE_ROOT}/colleges/{college_id}/temp/{job_id}.pdf
  TTL: 1 hour — nightly cleanup job deletes it.
"""
import logging
import os
import subprocess

import httpx

logger = logging.getLogger(__name__)

STORAGE_ROOT = (
    os.environ.get("STORAGE_ROOT")
    or os.environ.get("UPLOADS_DIR")
    or os.path.join(os.getcwd(), "uploads")
)


def _temp_dir(college_id: str) -> str:
    d = os.path.join(STORAGE_ROOT, "colleges", college_id, "temp")
    os.makedirs(d, exist_ok=True)
    return d


async def post_extraction_callback(callback_url: str, college_id: str, payload: dict) -> None:
    headers = {
        "x-internal-secret": os.environ["API_INTERNAL_SECRET"],
        "x-college-id":      college_id,
        "Content-Type":      "application/json",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(callback_url, json=payload, headers=headers)
        resp.raise_for_status()


def _extract_pdf_pages(source_path: str, pages: list[int], output_path: str) -> None:
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(source_path)
    total  = len(reader.pages)
    writer = PdfWriter()
    for page_num in pages:
        if page_num < 1 or page_num > total:
            raise ValueError(f"Page {page_num} out of range (1–{total})")
        writer.add_page(reader.pages[page_num - 1])
    with open(output_path, "wb") as fh:
        writer.write(fh)


def run_extract_pages(job_data: dict) -> str:
    """
    Synchronous extraction. Returns output_path on success. Raises on failure.
    """
    job_id    = job_data["job_id"]
    college_id = job_data["college_id"]
    file_type = job_data["file_type"]
    file_path = job_data["file_path"]
    pages: list[int] = job_data["pages"]

    tmp_dir     = _temp_dir(college_id)
    output_path = os.path.join(tmp_dir, f"{job_id}.pdf")

    if file_type == "pdf":
        _extract_pdf_pages(file_path, pages, output_path)

    elif file_type == "pptx":
        # LibreOffice converts the full PPTX to PDF (1 slide = 1 page), then
        # we extract only the requested slide pages with pypdf.
        basename      = os.path.splitext(os.path.basename(file_path))[0]
        converted_pdf = os.path.join(tmp_dir, f"{basename}.pdf")
        try:
            subprocess.run(
                [
                    "libreoffice", "--headless",
                    "--convert-to", "pdf",
                    "--outdir", tmp_dir,
                    file_path,
                ],
                check=True,
                capture_output=True,
                timeout=120,
            )
            if not os.path.exists(converted_pdf):
                raise RuntimeError("LibreOffice conversion produced no output")
            _extract_pdf_pages(converted_pdf, pages, output_path)
        finally:
            try:
                os.unlink(converted_pdf)
            except OSError:
                pass
    else:
        raise ValueError(f"Unsupported file type for extraction: {file_type}")

    logger.info("Extraction complete: job_id=%s output=%s", job_id, output_path)
    return output_path
