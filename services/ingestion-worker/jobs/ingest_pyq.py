"""
PYQ ingestion pipeline — F-13-E.

Steps:
  1. Extract full text from the PYQ PDF
  2. Use Claude Haiku to extract individual questions as JSON
  3. Embed each question with OpenAI
  4. Upsert vectors to the PYQ Pinecone namespace (c_{college}_d_{dept}_pyq)
  5. Save pyq_question records to MongoDB via API callback
  6. Map questions to textbook chapters (update chapter_maps)
  7. POST completion callback to Fastify

Job payload keys:
  pyq_paper_id, doc_id, college_id, dept_id, subject_id,
  file_path, year, month, exam_name, university, callback_url
"""
import json
import logging
import os
import uuid

import fitz           # PyMuPDF — already in requirements
import httpx

fitz.TOOLS.mupdf_display_errors(False)  # suppress non-fatal MuPDF warnings
from anthropic import Anthropic
from openai import OpenAI
from pinecone import Pinecone

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY      = os.environ.get("OPENAI_API_KEY", "")
PINECONE_API_KEY    = os.environ.get("PINECONE_API_KEY", "")
PINECONE_INDEX_NAME = os.environ.get("PINECONE_INDEX_NAME", "")
EMBEDDING_MODEL     = "text-embedding-3-small"
EMBEDDING_DIMS      = 1536
EXTRACTION_MODEL    = "claude-haiku-4-5-20251001"
API_INTERNAL_SECRET = os.environ.get("API_INTERNAL_SECRET", "")
MAPPING_THRESHOLD   = float(os.environ.get("PYQ_CHAPTER_MAPPING_THRESHOLD", "0.72"))
UPSERT_BATCH        = 100

_anthropic: Anthropic | None = None
_openai: OpenAI | None       = None
_pinecone: Pinecone | None   = None


def _get_anthropic() -> Anthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = Anthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic


def _get_openai() -> OpenAI:
    global _openai
    if _openai is None:
        _openai = OpenAI(api_key=OPENAI_API_KEY)
    return _openai


def _get_pinecone_index():
    global _pinecone
    if _pinecone is None:
        _pinecone = Pinecone(api_key=PINECONE_API_KEY)
    return _pinecone.index(PINECONE_INDEX_NAME)


# ── Step 1: text extraction ───────────────────────────────────────────────────

def _extract_text(file_path: str) -> str:
    doc = fitz.open(file_path)
    pages = [page.get_text() for page in doc]
    doc.close()
    return "\n".join(pages)


# ── Step 2: question extraction via Claude Haiku ──────────────────────────────

def _extract_questions(full_text: str) -> list[dict]:
    prompt = f"""Extract all exam questions from this question paper.
Return ONLY a valid JSON array. No preamble, no markdown fences.
Each item must have these keys:
  "question_text": the full question (string),
  "marks": integer or null,
  "section": section label such as "A" or null,
  "question_type": one of MCQ|SAQ|LAQ|CASE|FIB

Question paper text:
{full_text[:8000]}"""

    response = _get_anthropic().messages.create(
        model=EXTRACTION_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


# ── Step 3: embed questions ───────────────────────────────────────────────────

def _embed_texts(texts: list[str]) -> list[list[float]]:
    client = _get_openai()
    embeddings: list[list[float]] = []
    for i in range(0, len(texts), 100):
        batch = texts[i : i + 100]
        resp = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        embeddings.extend([item.embedding for item in resp.data])
    return embeddings


# ── Step 4: upsert to Pinecone PYQ namespace ─────────────────────────────────

def _upsert_pyq_vectors(vectors: list[dict], namespace: str) -> None:
    index = _get_pinecone_index()
    for i in range(0, len(vectors), UPSERT_BATCH):
        batch = vectors[i : i + UPSERT_BATCH]
        index.namespace(namespace).upsert(vectors=batch)


# ── Step 6: map questions to chapters ────────────────────────────────────────

def _map_to_chapters(
    college_id: str,
    dept_id: str,
    question_records: list[dict],
    api_base: str,
) -> None:
    """
    Uses the /internal/ingest/pyq/map-chapters endpoint instead of direct MongoDB
    to keep MongoDB writes in TypeScript and avoid motor dependency here.
    """
    try:
        httpx.post(
            f"{api_base}/api/v1/internal/ingest/pyq/map-chapters",
            json={
                "college_id":         college_id,
                "dept_id":            dept_id,
                "question_records":   question_records,
                "mapping_threshold":  MAPPING_THRESHOLD,
            },
            headers={
                "x-internal-secret": API_INTERNAL_SECRET,
                "x-college-id":      college_id,
            },
            timeout=120.0,
        )
    except Exception as exc:
        logger.warning("map-chapters call failed (non-fatal): %s", exc)


# ── Main entry ────────────────────────────────────────────────────────────────

async def run_ingest_pyq(job_data: dict) -> None:
    pyq_paper_id = job_data["pyq_paper_id"]
    college_id   = job_data["college_id"]
    dept_id      = job_data["dept_id"]
    subject_id   = job_data["subject_id"]
    file_path    = job_data["file_path"]
    year         = job_data["year"]
    exam_name    = job_data["exam_name"]
    callback_url = job_data["callback_url"]

    namespace = f"c_{college_id}_d_{dept_id}_pyq"
    api_base  = os.environ.get("API_BASE_URL", "http://localhost:3000")

    # 1. Extract text
    full_text = _extract_text(file_path)

    # 2. Extract questions with Claude Haiku
    try:
        questions_raw = _extract_questions(full_text)
    except Exception as exc:
        logger.error("Question extraction failed: %s", exc)
        raise

    if not questions_raw:
        raise ValueError("No questions extracted from PYQ paper")

    # 3. Embed all question texts
    texts      = [q.get("question_text", "") for q in questions_raw]
    embeddings = _embed_texts(texts)

    # 4. Build Pinecone vectors + MongoDB records
    vectors          : list[dict] = []
    question_records : list[dict] = []

    for q, emb in zip(questions_raw, embeddings):
        qid       = str(uuid.uuid4())
        vector_id = f"pyq_{qid}"

        vectors.append({
            "id":     vector_id,
            "values": emb,
            "metadata": {
                "pyq_question_id": qid,
                "pyq_paper_id":    pyq_paper_id,
                "college_id":      college_id,
                "dept_id":         dept_id,
                "question_text":   q.get("question_text", "")[:500],
                "marks":           q.get("marks") or 0,
                "question_type":   q.get("question_type", "SAQ"),
                "year":            year,
                "exam_name":       exam_name,
            },
        })
        question_records.append({
            "_id":                   qid,
            "pyq_paper_id":          pyq_paper_id,
            "college_id":            college_id,
            "dept_id":               dept_id,
            "subject_id":            subject_id,
            "question_text":         q.get("question_text", ""),
            "question_type":         q.get("question_type", "SAQ"),
            "marks":                 q.get("marks") or 0,
            "section":               q.get("section") or "",
            "year":                  year,
            "exam_name":             exam_name,
            "mapped_chapter_indices": [],
            "mapping_confidence":    0.0,
            "pinecone_vector_id":    vector_id,
        })

    # 5. Upsert to Pinecone
    _upsert_pyq_vectors(vectors, namespace)

    # 6. Persist question records via API
    httpx.post(
        f"{api_base}/api/v1/internal/ingest/pyq/{pyq_paper_id}/questions",
        json={"questions": question_records, "college_id": college_id},
        headers={
            "x-internal-secret": API_INTERNAL_SECRET,
            "x-college-id":      college_id,
        },
        timeout=60.0,
    ).raise_for_status()

    # 7. Trigger chapter mapping (non-blocking, errors non-fatal)
    _map_to_chapters(college_id, dept_id, question_records, api_base)

    # 8. POST completion callback
    await post_pyq_callback(callback_url, college_id, {
        "status":         "completed",
        "question_count": len(question_records),
    })


async def post_pyq_callback(url: str, college_id: str, payload: dict) -> None:
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                url,
                json=payload,
                headers={
                    "x-internal-secret": API_INTERNAL_SECRET,
                    "x-college-id":      college_id,
                },
                timeout=15.0,
            )
    except Exception as exc:
        logger.warning("PYQ callback POST failed: %s", exc)


async def post_pyq_failure(url: str, college_id: str, error: str) -> None:
    await post_pyq_callback(url, college_id, {"status": "failed", "error": error})
