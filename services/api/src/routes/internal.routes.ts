import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { IngestionCallbackPayload } from "@college-chatbot/shared";
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { getExtractionJobModel } from "../models/college/extraction-job.model";
import { getDepartmentModel } from "../models/college/department.model";
import { getStudentModel } from "../models/college/student.model";

const callbackSchema = z.object({
  status: z.enum(["completed", "failed"]),
  chunk_count: z.number().int().nonnegative().optional(),
  quality_score: z.number().min(0).max(1).optional(),
  ocr_used: z.boolean().optional(),
  error: z.string().optional(),
  // F-11: populated by updated ingestion worker
  text_cache_path: z.string().optional(),
  thumbnail_path: z.string().optional(),
  transcript_path: z.string().optional(),
  page_count: z.number().int().positive().optional(),
  slide_count: z.number().int().positive().optional(),
  duration_seconds: z.number().positive().optional(),
});

const internalRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post(
    "/ingest/:docId/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate internal secret
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const { docId } = request.params as { docId: string };
      const parsed = callbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: parsed.error.message });
      }

      const payload = parsed.data as IngestionCallbackPayload;

      // Locate document across all college DBs by scanning — we need college_id
      // The ingestion worker must include college_id in callback or we look it up via docId.
      // Spec: docId doubles as jobId, college_id is in the job payload.
      // Worker should POST with x-college-id header.
      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const conn = await getCollegeDb(collegeId);
      const Document = getDocumentModel(conn);
      const doc = await Document.findById(docId);
      if (!doc) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Document not found" });
      }

      if (payload.status === "completed") {
        const completedFields: Record<string, unknown> = {
          ingestion_status: "completed",
          chunk_count: payload.chunk_count ?? 0,
          quality_score: payload.quality_score ?? 0,
          ocr_used: payload.ocr_used ?? false,
          ingestion_error: undefined,
        };
        if (payload.text_cache_path)  completedFields.text_cache_path  = payload.text_cache_path;
        if (payload.thumbnail_path)   completedFields.thumbnail_path   = payload.thumbnail_path;
        if (payload.transcript_path)  completedFields.transcript_path  = payload.transcript_path;
        if (payload.page_count)       completedFields.page_count       = payload.page_count;
        if (payload.slide_count)      completedFields.slide_count      = payload.slide_count;
        if (payload.duration_seconds) completedFields.duration_seconds = payload.duration_seconds;

        await Document.findByIdAndUpdate(docId, { $set: completedFields });

        // If dept had no completed docs before, re-evaluate students using generic fallback
        const Department = getDepartmentModel(conn);
        const dept = await Department.findById(doc.dept_id);
        if (dept && !dept.is_generic) {
          const completedCount = await Document.countDocuments({
            dept_id: doc.dept_id,
            ingestion_status: "completed",
          });
          if (completedCount === 1) {
            // First completed doc — migrate generic-fallback students back
            const Student = getStudentModel(conn);
            await Student.updateMany(
              { dept_id: doc.dept_id, using_generic_fallback: true },
              { $set: { using_generic_fallback: false, effective_dept_id: doc.dept_id } },
            );
          }
        }
      } else {
        await Document.findByIdAndUpdate(docId, {
          $set: {
            ingestion_status: "failed",
            ingestion_error: payload.error ?? "Unknown error",
          },
        });
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── Extraction job callback (from Python extract_pages worker) ──────────
  const extractionCallbackSchema = z.object({
    status:           z.enum(["processing", "completed", "failed"]),
    output_file_path: z.string().optional(),
    error:            z.string().optional(),
  });

  fastify.post(
    "/extract-jobs/:jobId/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const secret = request.headers["x-internal-secret"];
      if (!secret || secret !== process.env.API_INTERNAL_SECRET) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized" });
      }

      const { jobId } = request.params as { jobId: string };
      const collegeId = request.headers["x-college-id"] as string | undefined;
      if (!collegeId) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "x-college-id header required" });
      }

      const parsed = extractionCallbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: parsed.error.message });
      }

      const { status, output_file_path, error } = parsed.data;
      const conn = await getCollegeDb(collegeId);
      const ExtractionJob = getExtractionJobModel(conn);

      const patch: Record<string, unknown> = { status };
      if (status === "completed" && output_file_path) {
        patch.output_file_path = output_file_path;
        patch.completed_at     = new Date();
        patch.expires_at       = new Date(Date.now() + 3_600_000); // 1-hour TTL
      }
      if (status === "failed" && error) {
        patch.error = error;
      }

      const job = await ExtractionJob.findByIdAndUpdate(jobId, { $set: patch }, { new: true });
      if (!job) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Extraction job not found" });
      }

      return reply.status(200).send({ ok: true });
    },
  );
}

export const internalRoutes = internalRoutesPlugin;
