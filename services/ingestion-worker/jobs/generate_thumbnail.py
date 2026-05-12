"""
Thumbnail generator (JPEG) for document library previews.

Supported:
  pdf  — render first page via PyMuPDF + Pillow
  pptx — LibreOffice headless → first-slide PNG → Pillow JPEG
  mp4/mkv — ffmpeg first frame at 1 second
  mp3/m4a/docx — None (no thumbnail)
"""
import logging
import os
import subprocess
import tempfile

logger = logging.getLogger(__name__)

THUMBNAIL_DPI = 72
THUMBNAIL_QUALITY = 85


def generate_thumbnail(file_path: str, file_type: str, out_path: str) -> str | None:
    """
    Write thumbnail JPEG to out_path.
    Returns out_path on success; None when file_type has no thumbnail or generation fails.
    """
    try:
        match file_type:
            case "pdf":
                return _thumb_pdf(file_path, out_path)
            case "pptx":
                return _thumb_pptx(file_path, out_path)
            case "mp4" | "mkv":
                return _thumb_video(file_path, out_path)
            case _:
                return None
    except Exception:
        logger.warning("Thumbnail generation failed for %s (%s)", file_path, file_type, exc_info=True)
        return None


def _ensure_parent(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)


def _thumb_pdf(file_path: str, out_path: str) -> str | None:
    import fitz
    from PIL import Image

    doc = fitz.open(file_path)
    if doc.page_count == 0:
        doc.close()
        return None

    page = doc[0]
    pix = page.get_pixmap(dpi=THUMBNAIL_DPI, colorspace=fitz.csRGB, alpha=False)
    doc.close()

    _ensure_parent(out_path)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    img.save(out_path, "JPEG", quality=THUMBNAIL_QUALITY)
    return out_path


def _thumb_pptx(file_path: str, out_path: str) -> str | None:
    """
    LibreOffice headless converts all slides to PNG in a temp dir.
    We grab the first file (alphabetically) as the cover thumbnail.
    """
    from PIL import Image

    with tempfile.TemporaryDirectory() as tmp_dir:
        result = subprocess.run(
            [
                "libreoffice", "--headless",
                "--convert-to", "png",
                "--outdir", tmp_dir,
                file_path,
            ],
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0:
            return None

        pngs = sorted(f for f in os.listdir(tmp_dir) if f.lower().endswith(".png"))
        if not pngs:
            return None

        _ensure_parent(out_path)
        img = Image.open(os.path.join(tmp_dir, pngs[0])).convert("RGB")
        img.save(out_path, "JPEG", quality=THUMBNAIL_QUALITY)
        return out_path


def _thumb_video(file_path: str, out_path: str) -> str | None:
    _ensure_parent(out_path)
    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", "1",
            "-i", file_path,
            "-frames:v", "1",
            "-q:v", "5",
            out_path,
        ],
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0 or not os.path.exists(out_path):
        return None
    return out_path
