"""
BullMQ worker — consumes jobs from the "ingestion_jobs" queue.
Calls ingest_document.run_pipeline and POSTs callback to Fastify.
"""
import asyncio
import logging
import os
import sys

# bullmq/redis-py use selector-based I/O which is incompatible with Windows
# ProactorEventLoop (default on Python 3.8+ / Windows). Force SelectorEventLoop.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from dotenv import load_dotenv
from bullmq import Worker

load_dotenv()

from jobs.ingest_document import run_pipeline, post_callback
from jobs.extract_pages import run_extract_pages, post_extraction_callback
from jobs.extract_chapters import run_extract_chapters, post_chapter_failure
from jobs.ingest_pyq import run_ingest_pyq, post_pyq_failure

logger = logging.getLogger(__name__)

QUEUE_NAME = "ingestion_jobs"


async def _handle_ingest(job_data: dict, job) -> dict:
    callback_url: str = job_data["callback_url"]
    college_id:   str = job_data["college_id"]

    try:
        result = await asyncio.to_thread(run_pipeline, job_data)

        payload: dict = {
            "status":        "completed",
            "chunk_count":   result["chunk_count"],
            "quality_score": result["quality_score"],
            "ocr_used":      result["ocr_used"],
        }
        for key in (
            "text_cache_path", "thumbnail_path", "transcript_path",
            "page_count", "slide_count", "duration_seconds",
        ):
            if result.get(key) is not None:
                payload[key] = result[key]

        await post_callback(callback_url, payload, college_id)
        return result

    except Exception as exc:
        logger.exception("Ingest failed: doc_id=%s attempt=%d", job_data.get("doc_id"), job.attemptsMade)
        max_attempts = job.opts.get("attempts", 1) if job.opts else 1
        if job.attemptsMade + 1 >= max_attempts:
            try:
                await post_callback(callback_url, {"status": "failed", "error": str(exc)}, college_id)
            except Exception:
                logger.exception("Failed to POST failure callback for doc_id=%s", job_data.get("doc_id"))
        raise


async def _handle_extract_pages(job_data: dict) -> dict:
    callback_url: str = job_data["callback_url"]
    college_id:   str = job_data["college_id"]
    job_id:       str = job_data["job_id"]

    try:
        await post_extraction_callback(callback_url, college_id, {"status": "processing"})
        output_path = await asyncio.to_thread(run_extract_pages, job_data)
        await post_extraction_callback(callback_url, college_id, {
            "status":           "completed",
            "output_file_path": output_path,
        })
        return {"output_file_path": output_path}

    except Exception as exc:
        logger.exception("Extraction failed: job_id=%s", job_id)
        try:
            await post_extraction_callback(callback_url, college_id, {
                "status": "failed",
                "error":  str(exc),
            })
        except Exception:
            logger.exception("Failed to POST extraction failure callback for job_id=%s", job_id)
        raise


async def _handle_ingest_pyq(job_data: dict) -> dict:
    callback_url: str = job_data["callback_url"]
    college_id:   str = job_data["college_id"]
    pyq_paper_id: str = job_data["pyq_paper_id"]

    try:
        await run_ingest_pyq(job_data)
        return {"status": "completed", "pyq_paper_id": pyq_paper_id}

    except Exception as exc:
        logger.exception("PYQ ingestion failed: pyq_paper_id=%s", pyq_paper_id)
        await post_pyq_failure(callback_url, college_id, str(exc))
        raise


async def _handle_extract_chapters(job_data: dict) -> dict:
    callback_url: str = job_data["callback_url"]
    college_id:   str = job_data["college_id"]
    doc_id:       str = job_data["doc_id"]

    try:
        await run_extract_chapters(job_data)
        return {"status": "completed", "doc_id": doc_id}

    except Exception as exc:
        logger.exception("Chapter extraction failed: doc_id=%s", doc_id)
        await post_chapter_failure(callback_url, college_id, str(exc))
        raise


async def process_job(job, job_token: str) -> dict:
    job_data: dict = job.data
    job_type: str  = job_data.get("job_type", "ingest")

    if job_type == "extract_pages":
        return await _handle_extract_pages(job_data)
    elif job_type == "extract_chapters":
        return await _handle_extract_chapters(job_data)
    elif job_type == "ingest_pyq":
        return await _handle_ingest_pyq(job_data)
    else:
        return await _handle_ingest(job_data, job)


async def start_worker() -> Worker:
    redis_url = os.environ["REDIS_URL"]
    concurrency = int(os.environ.get("WORKER_CONCURRENCY", "4"))

    worker = Worker(
        QUEUE_NAME,
        process_job,
        {"connection": redis_url, "concurrency": concurrency},
    )

    logger.info(
        "Worker started: queue=%s concurrency=%d redis=%s",
        QUEUE_NAME,
        concurrency,
        redis_url,
    )
    return worker


async def _standalone_main() -> None:
    """Entry point when running worker.py directly (without FastAPI)."""
    worker = await start_worker()
    try:
        await asyncio.Event().wait()  # block forever
    finally:
        await worker.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    asyncio.run(_standalone_main())
