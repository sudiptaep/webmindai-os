import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { IngestionJobPayload, ExtractionJobPayload, ChapterExtractionJobPayload, PYQIngestionJobPayload } from "@college-chatbot/shared";

const QUEUE_NAME = "ingestion_jobs";

let _connection: IORedis | null = null;
let _queue: Queue | null = null;

export function getRedisConnection(): IORedis {
  return getConnection();
}

function getConnection(): IORedis {
  if (!_connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL env var is not set");

    const isTLS = url.startsWith("rediss://");
    _connection = new IORedis(url, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
      tls: isTLS ? {} : undefined,
      db: 0,
    });
  }
  return _connection;
}

export function getIngestionQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: getConnection() });
  }
  return _queue;
}

export async function enqueueIngestionJob(payload: IngestionJobPayload): Promise<void> {
  const queue = getIngestionQueue();
  await queue.add(QUEUE_NAME, payload, {
    jobId: payload.doc_id, // doc_id doubles as job_id for webhook routing
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
}

export async function enqueueExtractionJob(payload: ExtractionJobPayload): Promise<void> {
  const queue = getIngestionQueue();
  await queue.add(QUEUE_NAME, payload, {
    jobId: payload.job_id,
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  });
}

export async function enqueueChapterExtractionJob(payload: ChapterExtractionJobPayload): Promise<void> {
  const queue = getIngestionQueue();
  await queue.add(QUEUE_NAME, payload, {
    jobId: `chapter_${payload.doc_id}_${Date.now()}`,
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
}

export async function enqueuePYQIngestionJob(payload: PYQIngestionJobPayload): Promise<void> {
  const queue = getIngestionQueue();
  await queue.add(QUEUE_NAME, payload, {
    jobId: `pyq_${payload.pyq_paper_id}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
}

export async function closeQueue(): Promise<void> {
  await _queue?.close();
  await _connection?.quit();
  _queue = null;
  _connection = null;
}
