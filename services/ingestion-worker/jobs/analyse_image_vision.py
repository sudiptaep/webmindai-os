"""
Image vision analysis using Anthropic Claude — F-17-B.

Uses Claude claude-haiku-4-5-20251001 (vision-capable, cost-efficient) with the 200px thumbnail
to minimise token usage. Sends thumbnail, not full image — sufficient for
understanding diagram content, type, and labels without paying for full
resolution OCR-level analysis.

Same JSON output contract as before; no changes to callers.
"""
import asyncio
import json
import logging
import os

import anthropic

logger = logging.getLogger(__name__)

VISION_MODEL = os.environ.get("VISION_MODEL", "claude-haiku-4-5-20251001")
VISION_MAX_TOKENS = int(os.environ.get("VISION_MAX_TOKENS", "600"))
VISION_BATCH_SIZE = int(os.environ.get("VISION_BATCH_SIZE", "5"))
VISION_BATCH_DELAY_SEC = float(os.environ.get("VISION_BATCH_DELAY_SEC", "1.0"))

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


VISION_SYSTEM_PROMPT = """You are an expert medical and engineering education content analyser.
You will be shown images extracted from academic textbooks and lecture materials.
Your task is to analyse each image and extract structured information that will help students
find and understand this image when they search for it.

Respond ONLY with a valid JSON object. No markdown, no preamble, no code fences.
Be precise, detailed, and use the exact technical terminology from the field."""


def _build_vision_prompt(
    doc_filename: str,
    page_num: int,
    dept_name: str,
    subject_name: str,
    figure_captions: list[dict] | None = None,
) -> str:
    caption_context = ""
    if figure_captions:
        lines = [
            f"  - {c['fig_label']} {c['fig_num']}: {c['caption_text']}"
            for c in figure_captions[:3]
        ]
        caption_context = (
            "\n\nGround-truth captions from the document text (use these exactly for the 'caption' field):\n"
            + "\n".join(lines)
        )

    return f"""Analyse this image extracted from:
Document: {doc_filename}
Page: {page_num}
Subject: {subject_name} ({dept_name}){caption_context}

Return this exact JSON structure:
{{
  "description": "Detailed description of the image (3-5 sentences). Describe what is shown, the relationships between components, and the educational significance. Use precise technical terminology.",
  "labels_extracted": ["list", "of", "every", "label", "text", "visible", "in", "image"],
  "caption": "One concise sentence describing what this image shows (15 words max). If ground-truth captions are provided above, use the most relevant one verbatim.",
  "image_type": "one of: anatomical_diagram | histology | pathology | flowchart | graph_chart | circuit_diagram | block_diagram | chemical_structure | clinical_image | photograph | table_image | equation | other",
  "clinical_relevance": "Brief note on when students encounter this in exams or clinical practice",
  "searchable_terms": ["list", "of", "10-20", "terms", "a", "student", "might", "search", "for", "to", "find", "this", "image"],
  "alt_text": "Concise accessibility description (1-2 sentences)"
}}"""


def _analyse_one(image_record: dict, doc_filename: str, page_num: int, dept_name: str, subject_name: str) -> dict:
    import base64

    figure_captions: list[dict] = image_record.get("figure_captions") or []

    # Use thumbnail for vision to minimise token usage
    thumb_path = image_record.get("thumbnail_path", "")
    full_path = image_record.get("file_path", "")
    img_path = thumb_path if thumb_path and os.path.exists(thumb_path) else full_path

    if not img_path or not os.path.exists(img_path):
        raise FileNotFoundError(f"No image file at thumb={thumb_path} or full={full_path}")

    with open(img_path, "rb") as fh:
        image_data = base64.standard_b64encode(fh.read()).decode("utf-8")

    client = _get_client()
    prompt_text = _build_vision_prompt(doc_filename, page_num, dept_name, subject_name, figure_captions)

    try:
        response = client.messages.create(
            model=VISION_MODEL,
            max_tokens=VISION_MAX_TOKENS,
            system=VISION_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_data,
                        },
                    },
                    {"type": "text", "text": prompt_text},
                ],
            }],
        )

        raw_text = response.content[0].text.strip()
        raw_text = raw_text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw_text)

        parsed["tokens_used"] = response.usage.input_tokens + response.usage.output_tokens
        parsed["model"] = VISION_MODEL
        return parsed

    except json.JSONDecodeError as exc:
        logger.warning("Vision returned non-JSON for %s page %d: %s", doc_filename, page_num, exc)
        fallback_caption = (
            f"{figure_captions[0]['fig_label']} {figure_captions[0]['fig_num']}: {figure_captions[0]['caption_text'][:100]}"
            if figure_captions else f"Figure from page {page_num}"
        )
        return {
            "description": f"Image on page {page_num} of {doc_filename}",
            "labels_extracted": [],
            "caption": fallback_caption,
            "image_type": "other",
            "clinical_relevance": "",
            "searchable_terms": [],
            "alt_text": f"Image from {doc_filename} page {page_num}",
            "tokens_used": response.usage.input_tokens + response.usage.output_tokens if "response" in dir() else 500,
            "model": VISION_MODEL,
        }


async def analyse_image_with_vision(
    image_record: dict,
    doc_filename: str,
    page_num: int,
    dept_name: str,
    subject_name: str,
) -> dict:
    return await asyncio.to_thread(_analyse_one, image_record, doc_filename, page_num, dept_name, subject_name)


async def analyse_images_batch(
    image_records: list[dict],
    doc_filename: str,
    dept_name: str,
    subject_name: str,
) -> list[dict]:
    """
    Process images in controlled batches. Returns one entry per input record:
    {image_record, vision_result, vision_status}.
    """
    results: list[dict] = []

    for i in range(0, len(image_records), VISION_BATCH_SIZE):
        batch = image_records[i:i + VISION_BATCH_SIZE]

        tasks = [
            analyse_image_with_vision(
                image_record=record,
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
                logger.warning("Vision failed for page %s: %s", record.get("source_page"), result)
                results.append({"image_record": record, "vision_result": None, "vision_status": "failed"})
            else:
                results.append({"image_record": record, "vision_result": result, "vision_status": "completed"})

        if i + VISION_BATCH_SIZE < len(image_records):
            await asyncio.sleep(VISION_BATCH_DELAY_SEC)

    return results
