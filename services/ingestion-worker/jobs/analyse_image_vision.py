"""
GPT-4o Vision analysis (low-res mode) — F-17-B.

Every image is sent with detail:"low" — a fixed 512x512 downscale, fixed 170
input tokens regardless of source resolution. Used for diagrams/figures, never
for OCR of body text (PyMuPDF/Tesseract already handle that).
"""
import asyncio
import json
import logging
import os

from openai import OpenAI

logger = logging.getLogger(__name__)

VISION_MODEL = os.environ.get("VISION_MODEL", "gpt-4o")
VISION_DETAIL = os.environ.get("VISION_DETAIL", "low")
VISION_MAX_TOKENS = int(os.environ.get("VISION_MAX_TOKENS", "600"))
VISION_BATCH_SIZE = int(os.environ.get("VISION_BATCH_SIZE", "5"))
VISION_BATCH_DELAY_SEC = float(os.environ.get("VISION_BATCH_DELAY_SEC", "1.0"))

_MIME_MAP = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


VISION_SYSTEM_PROMPT = """You are an expert medical and engineering education content analyser.
You will be shown images extracted from academic textbooks and lecture materials.
Your task is to analyse each image and extract structured information that will help students
find and understand this image when they search for it.

Respond ONLY with a valid JSON object. No markdown, no preamble, no code fences.
Be precise, detailed, and use the exact technical terminology from the field."""


def _build_vision_prompt(doc_filename: str, page_num: int, dept_name: str, subject_name: str) -> str:
    return f"""Analyse this image extracted from:
Document: {doc_filename}
Page: {page_num}
Subject: {subject_name} ({dept_name})

Return this exact JSON structure:
{{
  "description": "Detailed description of the image (3-5 sentences).
                  Describe what is shown, the relationships between components,
                  and the educational significance. Use precise technical terminology.",
  "labels_extracted": ["list", "of", "every", "label", "text", "visible", "in", "image"],
  "caption": "One concise sentence describing what this image shows (15 words max)",
  "image_type": "one of: anatomical_diagram | histology | pathology | flowchart |
                 graph_chart | circuit_diagram | block_diagram | chemical_structure |
                 clinical_image | photograph | table_image | equation | other",
  "clinical_relevance": "Brief note on when students encounter this in exams or clinical practice",
  "searchable_terms": ["list", "of", "10-20", "terms", "a", "student", "might", "search", "for",
                        "to", "find", "this", "image"],
  "alt_text": "Concise accessibility description (1-2 sentences)"
}}"""


def _analyse_one(image_path: str, doc_filename: str, page_num: int, dept_name: str, subject_name: str) -> dict:
    client = _get_client()

    with open(image_path, "rb") as fh:
        import base64
        image_data = base64.standard_b64encode(fh.read()).decode("utf-8")

    ext = image_path.lower().rsplit(".", 1)[-1]
    mime_type = _MIME_MAP.get(ext, "image/jpeg")

    try:
        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {"role": "system", "content": VISION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{image_data}",
                                "detail": VISION_DETAIL,
                            },
                        },
                        {"type": "text", "text": _build_vision_prompt(doc_filename, page_num, dept_name, subject_name)},
                    ],
                },
            ],
            max_tokens=VISION_MAX_TOKENS,
            temperature=0.1,
        )

        raw_text = response.choices[0].message.content.strip()
        raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw_text)

        parsed["tokens_used"] = response.usage.total_tokens
        parsed["model"] = VISION_MODEL
        parsed["detail"] = VISION_DETAIL
        return parsed

    except json.JSONDecodeError as exc:
        logger.warning("Vision returned non-JSON for %s: %s", image_path, exc)
        return {
            "description": f"Image on page {page_num} of {doc_filename}",
            "labels_extracted": [],
            "caption": f"Figure from page {page_num}",
            "image_type": "other",
            "clinical_relevance": "",
            "searchable_terms": [],
            "alt_text": f"Image from {doc_filename} page {page_num}",
            "tokens_used": 170,
            "model": VISION_MODEL,
            "detail": VISION_DETAIL,
        }


async def analyse_image_with_vision(image_path: str, doc_filename: str, page_num: int, dept_name: str, subject_name: str) -> dict:
    return await asyncio.to_thread(_analyse_one, image_path, doc_filename, page_num, dept_name, subject_name)


async def analyse_images_batch(
    image_records: list[dict],
    doc_filename: str,
    dept_name: str,
    subject_name: str,
) -> list[dict]:
    """
    Process images in controlled batches to respect OpenAI rate limits.
    Returns one entry per input record: {image_record, vision_result, vision_status}.
    """
    results: list[dict] = []

    for i in range(0, len(image_records), VISION_BATCH_SIZE):
        batch = image_records[i:i + VISION_BATCH_SIZE]

        tasks = [
            analyse_image_with_vision(
                image_path=record["file_path"],
                doc_filename=doc_filename,
                page_num=record["source_page"],
                dept_name=dept_name,
                subject_name=subject_name,
            )
            for record in batch
        ]

        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        for record, result in zip(batch, batch_results):
            if isinstance(result, Exception):
                logger.warning("Vision analysis failed for %s: %s", record.get("file_path"), result)
                results.append({"image_record": record, "vision_result": None, "vision_status": "failed"})
            else:
                results.append({"image_record": record, "vision_result": result, "vision_status": "completed"})

        if i + VISION_BATCH_SIZE < len(image_records):
            await asyncio.sleep(VISION_BATCH_DELAY_SEC)

    return results
