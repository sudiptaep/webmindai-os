"""
Image ingestion orchestrator — F-17.

Triggered as a follow-up job after the main text ingestion completes (see
internal.routes.ts). Pipeline:
  1. Extract images from PDF/PPTX (extract_images.py)
  2. Filter + dedup (done during extraction)
  3. GPT-4o Vision analysis, detail:"low" (analyse_image_vision.py)
  4. Embed descriptions (OpenAI text-embedding-3-small) + upsert to Pinecone
  5. POST ImageAsset records to Fastify (bulk-save) — worker has no direct Mongo access
  6. POST final status callback

Job payload keys: doc_id, college_id, dept_id, subject_id, file_path, file_type,
doc_filename, dept_name, subject_name, academic_year, callback_url, bulk_save_url
"""
import logging
import os
import uuid

import httpx
from openai import OpenAI

from jobs.extract_images import extract_images_from_pdf, extract_images_from_pptx
from jobs.analyse_image_vision import analyse_images_batch
from vector_store import upsert_image_vector

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
VISION_TOKEN_COST_PER_1M = 1.50  # gpt-4o input token rate, USD

_openai: OpenAI | None = None


def _get_openai() -> OpenAI:
    global _openai
    if _openai is None:
        _openai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _openai


def _build_embedding_text(vision_result: dict, doc_filename: str, page_num: int, subject_name: str) -> str:
    parts = [
        vision_result.get("description", ""),
        "Keywords: " + ", ".join(vision_result.get("searchable_terms", [])),
        "Labels: " + ", ".join(vision_result.get("labels_extracted", [])),
        vision_result.get("caption", ""),
        vision_result.get("clinical_relevance", ""),
        f"From: {doc_filename}, page {page_num}, subject: {subject_name}",
        f"Image type: {vision_result.get('image_type', 'other')}",
    ]
    return "\n".join(p for p in parts if p and p.strip())


def _asset_record_skipped(college_id: str, doc_id: str, dept_id: str, subject_id: str | None, img: dict) -> dict:
    return {
        "_id": str(uuid.uuid4()),
        "doc_id": doc_id,
        "college_id": college_id,
        "dept_id": dept_id,
        "subject_id": subject_id,
        "file_path": "",
        "thumbnail_path": "",
        "file_size_bytes": 0,
        "width_px": 0,
        "height_px": 0,
        "format": "jpg",
        "source_page": img["source_page"],
        "image_index_on_page": img.get("image_index_on_page", 0),
        "global_image_index": img.get("global_image_index", 0),
        "content_hash": img.get("content_hash", ""),
        "vision_status": "skipped",
        "labels_extracted": [],
        "searchable_terms": [],
        "was_filtered": True,
        "filter_reason": img.get("filter_reason"),
    }


async def handle_image_ingestion(job_data: dict) -> dict:
    doc_id = job_data["doc_id"]
    college_id = job_data["college_id"]
    dept_id = job_data["dept_id"]
    subject_id = job_data.get("subject_id")
    file_path = job_data["file_path"]
    file_type = job_data["file_type"]
    doc_filename = job_data["doc_filename"]
    dept_name = job_data["dept_name"]
    subject_name = job_data.get("subject_name") or ""
    academic_year = job_data["academic_year"]
    bulk_save_url = job_data["bulk_save_url"]

    if file_type == "pdf":
        raw_images = extract_images_from_pdf(file_path, doc_id, college_id)
    elif file_type == "pptx":
        raw_images = extract_images_from_pptx(file_path, doc_id, college_id)
    else:
        return {"image_count_raw": 0, "image_count_analysed": 0, "image_count_indexed": 0, "cost_usd": 0.0}

    qualifying = [img for img in raw_images if not img.get("was_filtered")]
    filtered = [img for img in raw_images if img.get("was_filtered")]

    asset_records: list[dict] = [
        _asset_record_skipped(college_id, doc_id, dept_id, subject_id, img) for img in filtered
    ]

    if qualifying:
        vision_results = await analyse_images_batch(qualifying, doc_filename, dept_name, subject_name)

        completed = [r for r in vision_results if r["vision_status"] == "completed"]
        for r in vision_results:
            if r["vision_status"] != "completed":
                rec = r["image_record"]
                asset_records.append({
                    **_asset_record_skipped(college_id, doc_id, dept_id, subject_id, {**rec, "filter_reason": None}),
                    "file_path": rec.get("file_path", ""),
                    "thumbnail_path": rec.get("thumbnail_path", ""),
                    "file_size_bytes": rec.get("file_size_bytes", 0),
                    "width_px": rec.get("width_px", 0),
                    "height_px": rec.get("height_px", 0),
                    "vision_status": "failed",
                    "was_filtered": False,
                    "filter_reason": None,
                })

        embedding_texts = [
            _build_embedding_text(r["vision_result"], doc_filename, r["image_record"]["source_page"], subject_name)
            for r in completed
        ]

        total_cost = 0.0
        indexed_count = 0

        if embedding_texts:
            client = _get_openai()
            embedding_response = client.embeddings.create(model=EMBEDDING_MODEL, input=embedding_texts)

            for result, embedding in zip(completed, embedding_response.data):
                rec = result["image_record"]
                vr = result["vision_result"]
                image_asset_id = str(uuid.uuid4())
                tokens_used = vr.get("tokens_used", 170)
                cost = tokens_used * VISION_TOKEN_COST_PER_1M / 1_000_000

                vector_id = upsert_image_vector(
                    image_asset_id, doc_id, college_id, dept_id, subject_id,
                    rec["source_page"], embedding.embedding, vr, doc_filename, academic_year,
                )

                asset_records.append({
                    "_id": image_asset_id,
                    "doc_id": doc_id,
                    "college_id": college_id,
                    "dept_id": dept_id,
                    "subject_id": subject_id,
                    "file_path": rec["file_path"],
                    "thumbnail_path": rec["thumbnail_path"],
                    "file_size_bytes": rec["file_size_bytes"],
                    "width_px": rec["width_px"],
                    "height_px": rec["height_px"],
                    "format": rec["format"],
                    "source_page": rec["source_page"],
                    "image_index_on_page": rec["image_index_on_page"],
                    "global_image_index": rec["global_image_index"],
                    "content_hash": rec["content_hash"],
                    "vision_status": "completed",
                    "vision_tokens_used": tokens_used,
                    "description": vr.get("description", ""),
                    "labels_extracted": vr.get("labels_extracted", []),
                    "caption": vr.get("caption", ""),
                    "image_type": vr.get("image_type", "other"),
                    "clinical_relevance": vr.get("clinical_relevance", ""),
                    "searchable_terms": vr.get("searchable_terms", []),
                    "alt_text": vr.get("alt_text", ""),
                    "pinecone_vector_id": vector_id,
                    "was_filtered": False,
                })

                total_cost += cost
                indexed_count += 1
    else:
        total_cost = 0.0
        indexed_count = 0

    if asset_records:
        await _post_bulk_save(bulk_save_url, college_id, asset_records)

    return {
        "image_count_raw": len(raw_images),
        "image_count_analysed": len(qualifying),
        "image_count_indexed": indexed_count,
        "cost_usd": round(total_cost, 6),
    }


async def _post_bulk_save(url: str, college_id: str, asset_records: list[dict]) -> None:
    headers = {
        "x-internal-secret": os.environ["API_INTERNAL_SECRET"],
        "x-college-id": college_id,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json={"images": asset_records}, headers=headers)
        resp.raise_for_status()


async def post_image_callback(url: str, college_id: str, payload: dict) -> None:
    headers = {
        "x-internal-secret": os.environ["API_INTERNAL_SECRET"],
        "x-college-id": college_id,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()


async def post_image_failure(url: str, college_id: str, error: str) -> None:
    try:
        await post_image_callback(url, college_id, {"status": "failed", "error": error})
    except Exception:
        logger.exception("Failed to POST image ingestion failure callback")
