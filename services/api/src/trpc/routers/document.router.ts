import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { getCollegeDb } from "../../db/college.db";
import { getDocumentModel } from "../../models/college/document.model";
import { getDownloadLogModel } from "../../models/college/download-log.model";
import { getImageAssetModel } from "../../models/college/image-asset.model";
import { deleteFile, resolveLocalPath } from "../../services/storage.service";
import { enqueueIngestionJob, enqueueChapterExtractionJob } from "../../services/queue.service";
import { deleteDocVectors } from "../../services/pinecone.service";
import { isDeptAdmin, isSuperAdmin, type DeptAdminJWTPayload } from "@college-chatbot/shared";
import type { AnyJWTPayload } from "@college-chatbot/shared";

function maskId(id: string): string {
  if (id.length <= 8) return "***";
  return `${id.slice(0, 3)}***${id.slice(-3)}`;
}

function requireAdminRole(user: AnyJWTPayload | null | undefined): asserts user is AnyJWTPayload {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  if (!isSuperAdmin(user) && !isDeptAdmin(user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" });
  }
}

async function resolveCollegeConn(user: AnyJWTPayload, collegeId: string) {
  if (isSuperAdmin(user)) {
    return getCollegeDb(collegeId);
  }
  if (isDeptAdmin(user)) {
    if (user.college_id !== collegeId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "College mismatch" });
    }
    return getCollegeDb(collegeId);
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" });
}

function checkDeptScope(user: DeptAdminJWTPayload, deptId: string) {
  if (user.dept_id !== deptId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
  }
}

export const documentRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        college_id: z.string(),
        dept_id: z.string().optional(),
        subject_id: z.string().nullable().optional(),
        ingestion_status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(500).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const filter: Record<string, unknown> = { college_id: input.college_id };

      if (input.dept_id) {
        if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, input.dept_id);
        filter.dept_id = input.dept_id;
      } else if (isDeptAdmin(ctx.user)) {
        filter.dept_id = ctx.user.dept_id;
      }

      if (input.subject_id !== undefined) {
        filter.subject_id = input.subject_id ?? { $in: [null, ""] };
      }

      if (input.ingestion_status) filter.ingestion_status = input.ingestion_status;

      const skip = (input.page - 1) * input.limit;
      const [docs, total] = await Promise.all([
        Document.find(filter as never).sort({ created_at: -1 }).skip(skip).limit(input.limit).lean(),
        Document.countDocuments(filter as never),
      ]);

      return { docs, total, page: input.page, limit: input.limit };
    }),

  get: protectedProcedure
    .input(z.object({ college_id: z.string(), doc_id: z.string() }))
    .query(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);

      const local_path = resolveLocalPath(doc.r2_key);
      return { ...doc, local_path };
    }),

  delete: protectedProcedure
    .input(z.object({ college_id: z.string(), doc_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);

      await deleteFile(doc.r2_key).catch(() => {});
      await deleteDocVectors(input.college_id, doc.dept_id, input.doc_id);
      await Document.findByIdAndDelete(input.doc_id);

      return { ok: true };
    }),

  updateLibrarySettings: protectedProcedure
    .input(
      z.object({
        college_id:              z.string(),
        doc_id:                  z.string(),
        download_enabled:        z.boolean().optional(),
        is_visible_to_students:  z.boolean().optional(),
        images_enabled:          z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);

      const patch: Record<string, unknown> = {};
      if (input.download_enabled       !== undefined) patch.download_enabled       = input.download_enabled;
      if (input.is_visible_to_students !== undefined) patch.is_visible_to_students = input.is_visible_to_students;
      if (input.images_enabled         !== undefined) patch.images_enabled         = input.images_enabled;

      if (Object.keys(patch).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      const updated = await Document.findByIdAndUpdate(
        input.doc_id,
        { $set: patch },
        { new: true, lean: true },
      );
      return updated;
    }),

  getDownloadLogs: protectedProcedure
    .input(
      z.object({
        college_id: z.string(),
        doc_id:     z.string(),
        limit:      z.number().int().min(1).max(500).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);

      const DownloadLog = getDownloadLogModel(conn);
      const logs = await DownloadLog.find({ doc_id: input.doc_id })
        .sort({ created_at: -1 })
        .limit(input.limit)
        .lean();

      // Mask student IDs — show first 3 + last 3 chars only (Super Admin sees full via separate auth)
      return logs.map(log => ({
        ...log,
        student_id: maskId(log.student_id),
      }));
    }),

  assignSubject: protectedProcedure
    .input(z.object({
      college_id: z.string(),
      doc_id:     z.string(),
      subject_id: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);

      await Document.findByIdAndUpdate(
        input.doc_id,
        input.subject_id ? { $set: { subject_id: input.subject_id } } : { $unset: { subject_id: "" } },
        { new: true },
      );
      return { ok: true };
    }),

  extractChapters: protectedProcedure
    .input(z.object({ college_id: z.string(), doc_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);
      if (doc.file_type !== "pdf") throw new TRPCError({ code: "BAD_REQUEST", message: "Chapter extraction only supported for PDF" });
      if (!doc.file_path) throw new TRPCError({ code: "BAD_REQUEST", message: "No local file path — re-ingest first" });

      const apiBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
      await enqueueChapterExtractionJob({
        job_id:       `chapter_${input.doc_id}`,
        doc_id:       input.doc_id,
        college_id:   input.college_id,
        dept_id:      doc.dept_id,
        file_path:    doc.file_path,
        job_type:     "extract_chapters",
        callback_url: `${apiBase}/api/v1/internal/ingest/${input.doc_id}/chapter-map/webhook`,
      });

      // Reset chapter map flag so UI shows "pending"
      await Document.findByIdAndUpdate(input.doc_id, {
        $set: { has_chapter_map: false, chapter_count: 0 },
      });

      return { doc_id: input.doc_id, status: "queued" };
    }),

  reingest: protectedProcedure
    .input(z.object({ college_id: z.string(), doc_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);

      await deleteDocVectors(input.college_id, doc.dept_id, input.doc_id);

      await Document.findByIdAndUpdate(input.doc_id, {
        $set: {
          ingestion_status: "pending",
          chunk_count: 0,
          quality_score: 0,
          ocr_used: false,
          ingestion_error: undefined,
        },
        $inc: { version: 1 },
      });

      const apiBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
      const callbackUrl = `${apiBase}/api/v1/internal/ingest/${input.doc_id}/webhook`;
      await enqueueIngestionJob({
        job_id: input.doc_id,
        doc_id: input.doc_id,
        college_id: input.college_id,
        dept_id: doc.dept_id,
        subject_id: doc.subject_id ?? null,
        r2_key: doc.r2_key,
        file_path: doc.file_path ?? undefined,
        file_type: doc.file_type,
        academic_year: doc.academic_year,
        job_type: "ingest",
        callback_url: callbackUrl,
      });

      return { doc_id: input.doc_id, status: "pending" };
    }),

  // F-17: Admin image management ────────────────────────────────────────────

  listImages: protectedProcedure
    .input(z.object({ college_id: z.string(), doc_id: z.string() }))
    .query(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);

      const ImageAsset = getImageAssetModel(conn);
      const images = await ImageAsset.find({ doc_id: input.doc_id }).sort({ global_image_index: 1 }).lean();

      const statusSummary = images.reduce<Record<string, number>>((acc, img) => {
        acc[img.vision_status] = (acc[img.vision_status] ?? 0) + 1;
        return acc;
      }, {});

      return {
        images,
        total: images.length,
        vision_status_summary: statusSummary,
        image_ingestion_status: doc.image_ingestion_status ?? "not_started",
        image_ingestion_cost_usd: doc.image_ingestion_cost_usd ?? 0,
      };
    }),

  hideImage: protectedProcedure
    .input(z.object({ college_id: z.string(), doc_id: z.string(), image_asset_id: z.string(), hidden: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const Document = getDocumentModel(conn);

      const doc = await Document.findById(input.doc_id).lean();
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, doc.dept_id);

      const ImageAsset = getImageAssetModel(conn);
      const updated = await ImageAsset.findOneAndUpdate(
        { _id: input.image_asset_id, doc_id: input.doc_id },
        { $set: { hidden: input.hidden } },
        { new: true, lean: true },
      );
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Image not found" });

      return { ok: true };
    }),
});
