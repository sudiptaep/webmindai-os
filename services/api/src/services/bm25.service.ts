/**
 * F-19-F: talks to the ingestion-worker's BM25 endpoints. This is the first
 * synchronous Node → Python call in the system — everything else is either
 * BullMQ (Node enqueues, Python dequeues) or Python calling back into Node's
 * webhooks. It exists because BM25 term hashing/tokenisation/stemming lives
 * in pinecone-text (Python) and must stay byte-for-byte identical between
 * indexing (ingestion-worker) and query-time encoding (here) — reimplementing
 * that in TypeScript would risk a silent index/query mismatch.
 */
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { getDepartmentModel } from "../models/college/department.model";

export interface SparseVector {
  indices: number[];
  values: number[];
}

function workerBaseUrl(): string {
  return process.env.INGESTION_WORKER_BASE_URL ?? "http://localhost:8001";
}

function internalHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-internal-secret": process.env.API_INTERNAL_SECRET ?? "",
  };
}

/**
 * Sparse-encodes a query using the department's fitted BM25 encoder.
 * Returns null if no encoder has been fitted yet, or on any request failure —
 * hybrid search degrades to dense-only rather than breaking retrieval.
 */
export async function encodeQuerySparse(
  collegeId: string,
  deptId: string,
  query: string,
): Promise<SparseVector | null> {
  try {
    const res = await fetch(`${workerBaseUrl()}/bm25/encode-query`, {
      method: "POST",
      headers: internalHeaders(),
      body: JSON.stringify({ college_id: collegeId, dept_id: deptId, query }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null; // 404 = no encoder fitted yet; any other failure also degrades gracefully
    return (await res.json()) as SparseVector;
  } catch {
    return null;
  }
}

export interface BM25FitResult {
  encoder_path: string;
  corpus_size: number;
}

/**
 * Admin-triggered: fits a fresh BM25 encoder on every completed document's
 * text cache in a department, and records the result on the Department doc.
 * Corpus-wide by nature — cannot run per-document, unlike embedding.
 */
export async function fitBM25ForDepartment(collegeId: string, deptId: string): Promise<BM25FitResult> {
  const conn = await getCollegeDb(collegeId);
  const Document = getDocumentModel(conn);

  const docs = await Document.find(
    { dept_id: deptId, ingestion_status: "completed", text_cache_path: { $exists: true, $ne: null } },
    { text_cache_path: 1 },
  ).lean();

  const textCachePaths = docs.map((d) => d.text_cache_path).filter((p): p is string => !!p);
  if (textCachePaths.length === 0) {
    throw new Error("No completed documents with a text cache found for this department");
  }

  const res = await fetch(`${workerBaseUrl()}/bm25/fit`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({ college_id: collegeId, dept_id: deptId, text_cache_paths: textCachePaths }),
    signal: AbortSignal.timeout(120_000), // fitting a large corpus is CPU-bound and can take a while
  });
  if (!res.ok) {
    throw new Error(`BM25 fit failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const result = (await res.json()) as BM25FitResult;

  const Department = getDepartmentModel(conn);
  await Department.findByIdAndUpdate(deptId, {
    $set: {
      bm25_encoder_path: result.encoder_path,
      bm25_fitted_at: new Date(),
      bm25_corpus_size: result.corpus_size,
    },
  });

  return result;
}
