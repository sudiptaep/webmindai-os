"""
FastAPI app — health endpoint + BullMQ worker lifecycle.
The worker runs as a background asyncio task alongside the HTTP server.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI

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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
