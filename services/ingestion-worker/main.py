"""
FastAPI app — health endpoint + BullMQ worker lifecycle.
The worker runs as a background asyncio task alongside the HTTP server.
"""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from bm25_encoder import encode_query, fit_and_save

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)

logger = logging.getLogger(__name__)

_worker = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _worker
    from worker import start_worker
    _worker = await start_worker()
    logger.info("Ingestion worker ready")
    yield
    if _worker:
        await _worker.close()
    logger.info("Ingestion worker stopped")


app = FastAPI(title="Ingestion Worker", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/metrics")
async def metrics():
    """Basic worker status — useful for monitoring."""
    if _worker is None:
        return {"worker": "not started"}
    return {"worker": "running", "queue": "ingestion_jobs"}


def _check_internal_secret(x_internal_secret: str | None) -> None:
    expected = os.environ.get("API_INTERNAL_SECRET")
    if not expected or x_internal_secret != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── F-19-F: BM25 sparse encoding (internal, called by the Node API) ─────────

class BM25FitRequest(BaseModel):
    college_id: str
    dept_id: str
    text_cache_paths: list[str]


class BM25EncodeQueryRequest(BaseModel):
    college_id: str
    dept_id: str
    query: str


def _read_corpus_texts(text_cache_paths: list[str]) -> list[str]:
    texts: list[str] = []
    for path in text_cache_paths:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                cache = json.load(fh)
            texts.extend(p["text"] for p in cache.get("pages", []) if p.get("text", "").strip())
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Skipping unreadable text cache %s: %s", path, exc)
    return texts


@app.post("/bm25/fit")
async def bm25_fit(req: BM25FitRequest, x_internal_secret: str | None = Header(default=None)):
    """
    Fits a fresh BM25 encoder on a department's full corpus and persists it —
    admin-triggered, not part of per-document ingestion (fitting needs the
    WHOLE corpus, a single document isn't enough). Runs on the event loop's
    thread pool since fit() is CPU-bound and can take a while on large depts.
    """
    _check_internal_secret(x_internal_secret)

    corpus_texts = await asyncio.to_thread(_read_corpus_texts, req.text_cache_paths)
    if not corpus_texts:
        raise HTTPException(status_code=400, detail="No readable text found across the given text_cache_paths")

    result = await asyncio.to_thread(fit_and_save, req.college_id, req.dept_id, corpus_texts)
    return result


@app.post("/bm25/encode-query")
async def bm25_encode_query_route(req: BM25EncodeQueryRequest, x_internal_secret: str | None = Header(default=None)):
    """Sparse-encodes a query string using the department's fitted BM25 encoder.
    Returns 404 if no encoder has been fitted for this department yet — the
    caller (rag.service.ts) treats that as "hybrid search unavailable, dense-only"."""
    _check_internal_secret(x_internal_secret)

    sparse = await asyncio.to_thread(encode_query, req.college_id, req.dept_id, req.query)
    if sparse is None:
        raise HTTPException(status_code=404, detail="No BM25 encoder fitted for this department")
    return sparse


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
