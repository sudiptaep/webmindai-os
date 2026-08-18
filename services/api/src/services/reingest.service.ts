/**
 * F-19 Step 9: admin-triggered re-ingestion for documents indexed under the
 * pre-F-19 pipeline. None of F-19-A (contextual enrichment), F-19-B
 * (hierarchical chunking), or F-19-F (sparse vectors) apply retroactively —
 * a document only gets them by running through ingest_document.py again.
 *
 * Re-ingestion reuses the exact same job the initial upload enqueues; the
 * pipeline itself (ingest_document.py) is what makes re-running it safe —
 * it diffs old vs. new Pinecone vector IDs and only deletes what the new
 * pass didn't produce, and only AFTER the new vectors are confirmed upserted.
 */
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { getDepartmentModel } from "../models/college/department.model";
import { getQueryLogModel } from "../models/college/query-log.model";
import { getCollegeModel } from "../models/platform/college.model";
import { enqueueIngestionJob } from "./queue.service";

// F-19 §12.1 worked example: Guyton & Hall, 1046 pages, ~$3.93 contextualisation
// cost. Scaling by page count gives a rough per-document estimate without
// needing to actually run the contextualiser first.
const REFERENCE_PAGE_COUNT = 1046;
const REFERENCE_COST_USD = 3.93;
const MIN_ESTIMATE_USD = 0.05;
const NON_PAGINATED_ESTIMATE_USD = 1.0; // audio/video docs have no page_count

function estimateCost(pageCount: number | undefined): number {
  if (!pageCount) return NON_PAGINATED_ESTIMATE_USD;
  return Math.max(MIN_ESTIMATE_USD, (pageCount / REFERENCE_PAGE_COUNT) * REFERENCE_COST_USD);
}

const NEEDS_REINGEST_FILTER = {
  ingestion_status: "completed",
  $or: [{ pipeline_version: { $exists: false } }, { pipeline_version: { $lt: 2 } }],
};

export interface ReingestCandidate {
  doc_id: string;
  filename: string;
  page_count?: number;
  estimated_cost_usd: number;
}

export async function listReingestCandidates(
  collegeId: string,
  deptId: string,
): Promise<{ candidates: ReingestCandidate[]; total_estimated_cost_usd: number }> {
  const conn = await getCollegeDb(collegeId);
  const Document = getDocumentModel(conn);

  const docs = await Document.find(
    { dept_id: deptId, ...NEEDS_REINGEST_FILTER },
    { original_filename: 1, page_count: 1 },
  ).lean();

  const candidates = docs.map((d) => ({
    doc_id: String(d._id),
    filename: d.original_filename,
    page_count: d.page_count,
    estimated_cost_usd: Math.round(estimateCost(d.page_count) * 100) / 100,
  }));

  return {
    candidates,
    total_estimated_cost_usd: Math.round(candidates.reduce((sum, c) => sum + c.estimated_cost_usd, 0) * 100) / 100,
  };
}

export async function triggerReingest(
  collegeId: string,
  deptId: string,
  docIds: string[],
): Promise<{ enqueued: number; skipped: number }> {
  const conn = await getCollegeDb(collegeId);
  const Document = getDocumentModel(conn);

  const [dept, college] = await Promise.all([
    getDepartmentModel(conn).findById(deptId).lean(),
    getCollegeModel().findById(collegeId).lean(),
  ]);

  const docs = await Document.find(
    { _id: { $in: docIds }, dept_id: deptId, ...NEEDS_REINGEST_FILTER },
    { subject_id: 1, r2_key: 1, file_path: 1, file_type: 1, academic_year: 1 },
  ).lean();

  const apiBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

  for (const doc of docs) {
    const docId = String(doc._id);
    await enqueueIngestionJob({
      job_id: docId,
      doc_id: docId,
      college_id: collegeId,
      dept_id: deptId,
      subject_id: doc.subject_id ?? null,
      r2_key: doc.r2_key,
      file_path: doc.file_path,
      file_type: doc.file_type,
      academic_year: doc.academic_year,
      callback_url: `${apiBase}/api/v1/internal/ingest/${docId}/webhook`,
      bulk_save_url: `${apiBase}/api/v1/internal/ingest/${docId}/parents/bulk-save`,
      dept_name: dept?.name,
      college_type: college?.type,
      job_type: "ingest",
    });
    await Document.findByIdAndUpdate(docId, { $set: { ingestion_status: "processing" } });
  }

  return { enqueued: docs.length, skipped: docIds.length - docs.length };
}

export interface DeptReingestPriority {
  dept_id: string;
  dept_name: string;
  query_volume_30d: number;
  docs_needing_reingest: number;
}

/** Depts ranked by recent query volume — highest-traffic depts should be re-ingested first (F-19 §14 Step 9). */
export async function listDeptReingestPriority(collegeId: string): Promise<DeptReingestPriority[]> {
  const conn = await getCollegeDb(collegeId);
  const Department = getDepartmentModel(conn);
  const QueryLog = getQueryLogModel(conn);
  const Document = getDocumentModel(conn);

  const depts = await Department.find({ deleted: { $ne: true } }, { name: 1 }).lean();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const results = await Promise.all(
    depts.map(async (dept) => {
      const deptId = String(dept._id);
      const [queryVolume, pendingCount] = await Promise.all([
        QueryLog.countDocuments({ dept_id: deptId, created_at: { $gte: thirtyDaysAgo } }),
        Document.countDocuments({ dept_id: deptId, ...NEEDS_REINGEST_FILTER }),
      ]);
      return { dept_id: deptId, dept_name: dept.name, query_volume_30d: queryVolume, docs_needing_reingest: pendingCount };
    }),
  );

  return results
    .filter((r) => r.docs_needing_reingest > 0)
    .sort((a, b) => b.query_volume_30d - a.query_volume_30d);
}
