"""
Image extraction — F-17-A.

Extracts embedded images from PDFs (PyMuPDF) and PPTX (python-pptx), filters
out icons/decorations/separators, dedups by content hash, and writes each
qualifying image + thumbnail to local disk under STORAGE_ROOT.
"""
import hashlib
import io
import logging
import os

import fitz  # PyMuPDF
from PIL import Image

logger = logging.getLogger(__name__)

IMAGE_MIN_WIDTH_PX = int(os.environ.get("IMAGE_MIN_WIDTH_PX", "100"))
IMAGE_MIN_HEIGHT_PX = int(os.environ.get("IMAGE_MIN_HEIGHT_PX", "100"))
IMAGE_MIN_SIZE_BYTES = int(os.environ.get("IMAGE_MIN_SIZE_BYTES", "10000"))
IMAGE_MAX_ASPECT_RATIO = float(os.environ.get("IMAGE_MAX_ASPECT_RATIO", "15"))
IMAGE_JPEG_QUALITY = int(os.environ.get("IMAGE_JPEG_QUALITY", "85"))
IMAGE_THUMBNAIL_SIZE = int(os.environ.get("IMAGE_THUMBNAIL_SIZE", "200"))
IMAGE_THUMBNAIL_QUALITY = int(os.environ.get("IMAGE_THUMBNAIL_QUALITY", "75"))


def _images_dir(college_id: str, doc_id: str) -> str:
    storage_root = (
        os.environ.get("STORAGE_ROOT")
        or os.environ.get("UPLOADS_DIR")
        or os.path.join(os.getcwd(), "uploads")
    )
    path = os.path.join(storage_root, "colleges", college_id, "images", doc_id)
    os.makedirs(path, exist_ok=True)
    return path


def _content_hash(img_bytes: bytes) -> str:
    return hashlib.md5(img_bytes).hexdigest()


def _should_skip(width: int, height: int, size_bytes: int) -> str | None:
    """Returns a filter_reason string if the image should be rejected, else None."""
    if width < IMAGE_MIN_WIDTH_PX or height < IMAGE_MIN_HEIGHT_PX:
        return "too_small"
    if size_bytes < IMAGE_MIN_SIZE_BYTES:
        return "too_small"
    if width > 0 and height > 0:
        ratio = max(width, height) / min(width, height)
        if ratio > IMAGE_MAX_ASPECT_RATIO:
            return "logo_icon"
    return None


def extract_images_from_pdf(file_path: str, doc_id: str, college_id: str) -> list[dict]:
    """
    Extract all embedded images from a PDF.
    Returns a list of image metadata dicts (was_filtered=True entries included).
    """
    images_dir = _images_dir(college_id, doc_id)
    pdf = fitz.open(file_path)
    extracted: list[dict] = []
    seen_hashes: set[str] = set()
    global_index = 0

    for page_num in range(len(pdf)):
        page = pdf[page_num]
        image_list = page.get_images(full=True)

        for img_idx, img_info in enumerate(image_list):
            xref = img_info[0]
            try:
                base_image = pdf.extract_image(xref)
                img_bytes = base_image["image"]
                img_width = base_image["width"]
                img_height = base_image["height"]

                filter_reason = _should_skip(img_width, img_height, len(img_bytes))
                if filter_reason:
                    extracted.append({
                        "was_filtered": True,
                        "filter_reason": filter_reason,
                        "source_page": page_num + 1,
                    })
                    continue

                content_hash = _content_hash(img_bytes)
                if content_hash in seen_hashes:
                    extracted.append({
                        "was_filtered": True,
                        "filter_reason": "duplicate",
                        "source_page": page_num + 1,
                        "content_hash": content_hash,
                    })
                    continue
                seen_hashes.add(content_hash)

                filename = f"page{page_num + 1:04d}_img{img_idx:02d}.jpg"
                file_path_out = os.path.join(images_dir, filename)

                pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                pil_img.save(file_path_out, "JPEG", quality=IMAGE_JPEG_QUALITY)

                thumb_path = os.path.join(images_dir, f"thumb_{filename}")
                thumb = pil_img.copy()
                thumb.thumbnail((IMAGE_THUMBNAIL_SIZE, IMAGE_THUMBNAIL_SIZE), Image.LANCZOS)
                thumb.save(thumb_path, "JPEG", quality=IMAGE_THUMBNAIL_QUALITY)

                extracted.append({
                    "was_filtered": False,
                    "file_path": file_path_out,
                    "thumbnail_path": thumb_path,
                    "file_size_bytes": os.path.getsize(file_path_out),
                    "width_px": pil_img.width,
                    "height_px": pil_img.height,
                    "format": "jpg",
                    "content_hash": content_hash,
                    "source_page": page_num + 1,
                    "image_index_on_page": img_idx,
                    "global_image_index": global_index,
                })
                global_index += 1

            except Exception as exc:
                logger.warning("Skip image xref=%s on page %d: %s", xref, page_num + 1, exc)
                continue

    pdf.close()
    return extracted


def extract_images_from_pptx(file_path: str, doc_id: str, college_id: str) -> list[dict]:
    """
    Extract all embedded images from a PPTX file. Each slide is treated as a "page".
    """
    from pptx import Presentation

    MSO_PICTURE = 13

    images_dir = _images_dir(college_id, doc_id)
    prs = Presentation(file_path)
    extracted: list[dict] = []
    seen_hashes: set[str] = set()
    global_index = 0

    for slide_num, slide in enumerate(prs.slides):
        img_idx = 0
        for shape in slide.shapes:
            if shape.shape_type != MSO_PICTURE:
                continue
            try:
                img_blob = shape.image.blob
                pil_img = Image.open(io.BytesIO(img_blob)).convert("RGB")

                filter_reason = _should_skip(pil_img.width, pil_img.height, len(img_blob))
                if filter_reason:
                    extracted.append({
                        "was_filtered": True,
                        "filter_reason": filter_reason,
                        "source_page": slide_num + 1,
                    })
                    img_idx += 1
                    continue

                content_hash = _content_hash(img_blob)
                if content_hash in seen_hashes:
                    extracted.append({
                        "was_filtered": True,
                        "filter_reason": "duplicate",
                        "source_page": slide_num + 1,
                        "content_hash": content_hash,
                    })
                    img_idx += 1
                    continue
                seen_hashes.add(content_hash)

                filename = f"slide{slide_num + 1:04d}_img{img_idx:02d}.jpg"
                file_path_out = os.path.join(images_dir, filename)
                pil_img.save(file_path_out, "JPEG", quality=IMAGE_JPEG_QUALITY)

                thumb_path = os.path.join(images_dir, f"thumb_{filename}")
                thumb = pil_img.copy()
                thumb.thumbnail((IMAGE_THUMBNAIL_SIZE, IMAGE_THUMBNAIL_SIZE), Image.LANCZOS)
                thumb.save(thumb_path, "JPEG", quality=IMAGE_THUMBNAIL_QUALITY)

                extracted.append({
                    "was_filtered": False,
                    "file_path": file_path_out,
                    "thumbnail_path": thumb_path,
                    "file_size_bytes": os.path.getsize(file_path_out),
                    "width_px": pil_img.width,
                    "height_px": pil_img.height,
                    "format": "jpg",
                    "content_hash": content_hash,
                    "source_page": slide_num + 1,
                    "image_index_on_page": img_idx,
                    "global_image_index": global_index,
                })
                img_idx += 1
                global_index += 1

            except Exception as exc:
                logger.warning("Skip PPTX image slide=%d: %s", slide_num + 1, exc)
                img_idx += 1
                continue

    return extracted
