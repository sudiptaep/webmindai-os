import fs from "fs";
import { randomUUID } from "crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { Connection } from "mongoose";
import {
  LLM_MODEL_CHAT,
  type StudentJWTPayload,
  type Document as ChatDocument,
  type LibraryAction,
} from "@college-chatbot/shared";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { getSubjectModel } from "../models/college/subject.model";
import { getDownloadLogModel } from "../models/college/download-log.model";
import { getExtractionJobModel } from "../models/college/extraction-job.model";
import { getChapterMapModel } from "../models/college/chapter-map.model";
import { getSessionModel } from "../models/college/session.model";
import { getCollegeModel } from "../models/platform/college.model";
import { embedQuery } from "../services/embedding.service";
import { runChapterRAG } from "../services/rag.service";
import { generateFileToken, getMimeType, TOKEN_TTL } from "../services/file-token.service";
import { enqueueExtractionJob, getRedisConnection } from "../services/queue.service";
import { resolveLocalPath } from "../services/storage.service";
import { streamChatResponse } from "../services/llm.service";
import { fetchDocChunks } from "../services/pinecone.service";
import { getStudentNotesModel } from "../models/college/student-notes.model";
import { getChapterSummaryModel } from "../models/college/chapter-summary.model";
import { getImageAssetModel } from "../models/college/image-asset.model";

// ── Rate limit config (env-overridable) ─────────────────────────────────────

const RATE_LIMITS = {
  downloads:        { max: Number(process.env.RATE_LIMIT_DOWNLOADS_PER_HOUR       ?? 20),  window: 3600  },
  text_extractions: { max: Number(process.env.RATE_LIMIT_TEXT_EXTRACTIONS_PER_DAY ?? 50),  window: 86400 },
  page_extractions: { max: Number(process.env.RATE_LIMIT_PAGE_EXTRACTIONS_PER_DAY ?? 5),   window: 86400 },
  ai_summaries:     { max: Number(process.env.RATE_LIMIT_AI_SUMMARIES_PER_DAY     ?? 10),  window: 86400 },
  streams:          { max: Number(process.env.RATE_LIMIT_STREAMS_PER_HOUR         ?? 5),   window: 3600  },
} as const;

const AI_SUMMARY_MAX_CONTEXT = Number(process.env.AI_SUMMARY_MAX_CONTEXT_CHARS ?? 80_000);
const AI_SUMMARY_MODEL       = process.env.AI_SUMMARY_MODEL ?? LLM_MODEL_CHAT;

const SUMMARY_PROMPTS: Record<string, string> = {
  brief:       "Summarise the following document in exactly 5 bullet points. Be concise and factual.",
  detailed:    "Create a structured outline of this document. Use ## for sections, ### for subsections. Include key points under each heading.",
  "key-terms": "Extract the 10 most important technical terms from this document. For each term: **Term**: Definition (1-2 sentences from the document).",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStudent(req: FastifyRequest): StudentJWTPayload {
  return req.user as StudentJWTPayload;
}


function getEffectiveFilePath(doc: ChatDocument): string {
  return doc.file_path ?? resolveLocalPath(doc.r2_key);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024)         return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function checkRateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  const redis = getRedisConnection();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count <= max;
}

function buildDocCard(doc: ChatDocument, thumbnailUrl: string | null) {
  return {
    doc_id:           doc._id,
    filename:         doc.original_filename,
    file_type:        doc.file_type,
    ingestion_status: doc.ingestion_status,
    file_size_bytes:  doc.file_size_bytes,
    file_size_display: formatFileSize(doc.file_size_bytes),
    page_count:       doc.page_count        ?? null,
    slide_count:      doc.slide_count       ?? null,
    duration_seconds: doc.duration_seconds  ?? null,
    quality_score:    doc.quality_score,
    ocr_used:         doc.ocr_used,
    download_enabled: doc.download_enabled !== false,
    thumbnail_url:    thumbnailUrl,
    academic_year:    doc.academic_year,
    uploaded_at:      doc.created_at,
    has_chapter_map:  doc.has_chapter_map   ?? false,
    chapter_count:    doc.chapter_count     ?? null,
  };
}

function safeDocMeta(doc: ChatDocument) {
  return {
    doc_id:                doc._id,
    dept_id:               doc.dept_id,
    subject_id:            doc.subject_id       ?? null,
    college_id:            doc.college_id,
    original_filename:     doc.original_filename,
    file_type:             doc.file_type,
    file_size_bytes:       doc.file_size_bytes,
    file_size_display:     formatFileSize(doc.file_size_bytes),
    ingestion_status:      doc.ingestion_status,
    chunk_count:           doc.chunk_count,
    ocr_used:              doc.ocr_used,
    quality_score:         doc.quality_score,
    page_count:            doc.page_count        ?? null,
    slide_count:           doc.slide_count       ?? null,
    duration_seconds:      doc.duration_seconds  ?? null,
    download_enabled:      doc.download_enabled  !== false,
    is_visible_to_students:doc.is_visible_to_students !== false,
    academic_year:         doc.academic_year,
    version:               doc.version,
    created_at:            doc.created_at,
    updated_at:            doc.updated_at,
  };
}

async function writeLog(
  conn: Connection,
  params: {
    collegeId: string; studentId: string; docId: string; deptId: string;
    action: LibraryAction; ipAddress?: string; userAgent?: string;
    pagesExtracted?: number[]; tokensUsed?: number;
  },
): Promise<void> {
  const DownloadLog = getDownloadLogModel(conn);
  await DownloadLog.create({
    _id:             randomUUID(),
    student_id:      params.studentId,
    doc_id:          params.docId,
    dept_id:         params.deptId,
    college_id:      params.collegeId,
    action:          params.action,
    ip_address:      params.ipAddress,
    user_agent:      params.userAgent,
    pages_extracted: params.pagesExtracted,
    tokens_used:     params.tokensUsed,
  });
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const libraryRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const PRE = [verifyJWT, resolveCollege, requireRole("student")];

  // ── F-11-A: Browse & Search ──────────────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const q = req.query as {
        subject_id?: string; type?: string; semester?: string; study_year?: string; year?: string;
        q?: string; sort?: string; order?: string; page?: string; limit?: string;
      };
      const student = getStudent(req);
      const page  = Math.max(1, Number(q.page  ?? 1));
      const limit = Math.min(100, Math.max(1, Number(q.limit ?? 20)));

      const conn     = await getCollegeDb(collegeId);
      const Document = getDocumentModel(conn);
      const Subject  = getSubjectModel(conn);

      // Derive student's year of study from JWT when not explicitly requested
      function deriveStudentYear(sem: number, collegeType: string): number {
        if (collegeType === "medical") return sem;
        return Math.ceil(sem / 2); // engineering: 2 sems per year
      }
      const defaultStudyYear = deriveStudentYear(student.semester, student.college_type);
      const activeStudyYear  = q.study_year ? Number(q.study_year) : defaultStudyYear;

      const filter: Record<string, unknown> = {
        is_visible_to_students: { $ne: false },
        ingestion_status:       { $nin: ["failed"] },
      };

      if (q.type && q.type !== "all") filter.file_type     = q.type;
      if (q.year)                      filter.academic_year = q.year;

      if (q.subject_id) {
        filter.subject_id = q.subject_id;
      } else if (q.semester) {
        // Explicit semester filter overrides year-based filter
        const semSubs = await Subject.find({ semester: Number(q.semester) }).lean();
        filter.subject_id = { $in: semSubs.map(s => String(s._id)) };
      } else {
        // Default: filter by student's year of study (explicit param or derived from semester)
        const yearSubs   = await Subject.find({ year: activeStudyYear }).lean();
        const yearSubIds = yearSubs.map(s => String(s._id));
        filter.$or = [
          { subject_id: { $in: yearSubIds } },
          { subject_id: null },
          { subject_id: { $exists: false } },
        ];
      }

      if (q.q) filter.original_filename = { $regex: q.q, $options: "i" };

      const sortFieldMap: Record<string, string> = {
        name: "original_filename", date: "created_at",
        size: "file_size_bytes",   type: "file_type",
      };
      const sortField = sortFieldMap[q.sort ?? "date"] ?? "created_at";
      const sortDir   = q.order === "asc" ? 1 : -1;

      // Fetch all (for correct totals), paginate in memory
      const allDocs  = await Document.find(filter as never)
        .sort({ [sortField]: sortDir } as Record<string, 1 | -1>)
        .lean();
      const total    = allDocs.length;
      const pageDocs = allDocs.slice((page - 1) * limit, page * limit);

      // Subject map for grouping labels (all subjects across all depts)
      const subjects    = await Subject.find({}).lean();
      const subjectMap  = new Map(subjects.map(s => [s._id as string, s]));

      // Thumbnail tokens (parallelised)
      const withThumbs = await Promise.all(
        pageDocs.map(async (doc) => {
          let thumbnailUrl: string | null = null;
          if (doc.thumbnail_path && fs.existsSync(doc.thumbnail_path)) {
            const token = await generateFileToken(
              {
                file_path:  doc.thumbnail_path,
                intent:     "preview",
                college_id: collegeId,
                dept_id:    doc.dept_id,
                student_id: student.sub,
                doc_id:     doc._id,
                filename:   `${doc._id}_thumb.jpg`,
                mime_type:  "image/jpeg",
                single_use: false,
              },
              300, // 5-min TTL — thumbnails are cheap to regenerate
            );
            thumbnailUrl = `/files/serve?token=${token}`;
          }
          return { doc, thumbnailUrl };
        }),
      );

      // Group paginated docs by subject
      const groupMap = new Map<string | null, ReturnType<typeof buildDocCard>[]>();
      for (const { doc, thumbnailUrl } of withThumbs) {
        const key = (doc.subject_id as string | undefined) ?? null;
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(buildDocCard(doc, thumbnailUrl));
      }

      const subjectGroups = Array.from(groupMap.entries()).map(([subjectId, docs]) => {
        const sub = subjectId ? subjectMap.get(subjectId) : null;
        return {
          subject_id:   subjectId,
          subject_name: sub?.name ?? "Department General",
          subject_code: sub?.code ?? null,
          semester:     sub?.semester ?? null,
          year:         sub?.year ?? null,
          doc_count:    docs.length,
          docs,
        };
      });

      subjectGroups.sort((a, b) => {
        const yr = (a.year ?? 999) - (b.year ?? 999);
        if (yr !== 0) return yr;
        return (a.semester ?? 999) - (b.semester ?? 999);
      });

      return reply.send({
        subjects:        subjectGroups,
        total_docs:      total,
        student_year:    activeStudyYear,
        pagination:      { page, limit, total_pages: Math.ceil(total / limit) },
      });
    },
  );

  // ── F-11-A: Single document metadata ────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };
      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();

      if (!doc)                                 return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false) return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });
      if (doc.ingestion_status !== "completed") return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: "Document not yet processed" });

      return reply.send(safeDocMeta(doc));
    },
  );

  // ── F-11-C: Generate access token ───────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/access-token",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };
      const { intent = "download" } = req.query as { intent?: string };
      const student = getStudent(req);

      if (!["download", "preview", "stream"].includes(intent)) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "intent must be download|preview|stream" });
      }

      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();

      if (!doc)                                 return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false) return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });
      if (doc.ingestion_status !== "completed") return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: "Document not yet processed" });
      if (intent === "download" && doc.download_enabled === false) {
        return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Download not permitted for this document" });
      }

      // Per-intent rate limits
      if (intent === "download") {
        const ok = await checkRateLimit(`rl_dl:${student.sub}`, RATE_LIMITS.downloads.max, RATE_LIMITS.downloads.window);
        if (!ok) return reply.status(429).send({ statusCode: 429, error: "Too Many Requests", message: "Download limit reached. Try again in an hour." });
      }
      if (intent === "stream") {
        const ok = await checkRateLimit(`rl_stream:${student.sub}`, RATE_LIMITS.streams.max, RATE_LIMITS.streams.window);
        if (!ok) return reply.status(429).send({ statusCode: 429, error: "Too Many Requests", message: "Stream limit reached. Try again in an hour." });
      }

      const ttl   = intent === "stream" ? TOKEN_TTL.stream : TOKEN_TTL.preview;
      const token = await generateFileToken(
        {
          file_path:  getEffectiveFilePath(doc),
          intent:     intent as "download" | "preview" | "stream",
          college_id: collegeId,
          dept_id:    doc.dept_id,
          student_id: student.sub,
          doc_id:     docId,
          filename:   doc.original_filename,
          mime_type:  getMimeType(doc.file_type),
          single_use: intent === "download",
        },
        ttl,
      );

      writeLog(conn, {
        collegeId, studentId: student.sub, docId, deptId: doc.dept_id,
        action: intent as LibraryAction, ipAddress: req.ip, userAgent: req.headers["user-agent"],
      }).catch(() => {});

      return reply.send({
        token_url:       `/files/serve?token=${token}`,
        expires_at:      new Date(Date.now() + ttl * 1000).toISOString(),
        filename:        doc.original_filename,
        file_size_bytes: doc.file_size_bytes,
        file_type:       doc.file_type,
      });
    },
  );

  // ── F-11-D: Extract full text ────────────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/extract-text",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };
      const { page: pageParam }  = req.query as { page?: string };
      const student = getStudent(req);

      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();

      if (!doc)                                      return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false)       return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });

      const ok = await checkRateLimit(`rl_txt:${student.sub}`, RATE_LIMITS.text_extractions.max, RATE_LIMITS.text_extractions.window);
      if (!ok) return reply.status(429).send({ statusCode: 429, error: "Too Many Requests", message: "Text extraction limit reached. Try again tomorrow." });

      if (!doc.text_cache_path || !fs.existsSync(doc.text_cache_path)) {
        return reply.status(503).send({ statusCode: 503, error: "Service Unavailable", message: "Text cache not available. Re-ingest the document to generate it." });
      }

      let textData: {
        total_pages: number; ocr_used: boolean; quality_score: number;
        pages: Array<{ page_num: number; text: string; ocr_confidence: number | null }>;
      };
      try {
        textData = JSON.parse(fs.readFileSync(doc.text_cache_path, "utf-8"));
      } catch {
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message: "Text cache corrupted" });
      }

      const pages = pageParam
        ? textData.pages.filter(p => p.page_num === Number(pageParam))
        : textData.pages;

      writeLog(conn, {
        collegeId, studentId: student.sub, docId, deptId: doc.dept_id,
        action: "extract_text", ipAddress: req.ip, userAgent: req.headers["user-agent"],
      }).catch(() => {});

      return reply.send({
        doc_id: docId, filename: doc.original_filename, file_type: doc.file_type,
        total_pages: textData.total_pages, ocr_used: textData.ocr_used,
        quality_score: textData.quality_score, pages,
      });
    },
  );

  // ── F-11-D: Download extracted text as .txt ──────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/extract-text/download",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };
      const student = getStudent(req);

      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();

      if (!doc)                                      return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false)       return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });

      if (!doc.text_cache_path || !fs.existsSync(doc.text_cache_path)) {
        return reply.status(503).send({ statusCode: 503, error: "Service Unavailable", message: "Text cache not available." });
      }

      let textData: { pages: Array<{ page_num: number; text: string }> };
      try {
        textData = JSON.parse(fs.readFileSync(doc.text_cache_path, "utf-8"));
      } catch {
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message: "Text cache corrupted" });
      }

      const fullText = textData.pages
        .map(p => `--- Page ${p.page_num} ---\n${p.text}`)
        .join("\n\n");
      const baseName = doc.original_filename.replace(/\.[^.]+$/, "");

      return reply
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${baseName}_text.txt"`)
        .send(fullText);
    },
  );

  // ── F-11-G: Transcript for audio/video ─────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/transcript",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();

      if (!doc)                                      return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false)       return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });
      if (!["mp4", "mkv", "mp3", "m4a"].includes(doc.file_type)) {
        return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: "Transcript only available for audio/video" });
      }
      if (!doc.transcript_path || !fs.existsSync(doc.transcript_path)) {
        return reply.status(503).send({ statusCode: 503, error: "Service Unavailable", message: "Transcript not yet available" });
      }

      let transcript: Array<{ start_sec: number; end_sec: number; text: string }>;
      try {
        transcript = JSON.parse(fs.readFileSync(doc.transcript_path, "utf-8"));
      } catch {
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message: "Transcript corrupted" });
      }

      return reply.send({ doc_id: docId, transcript });
    },
  );

  // ── F-11-E: Submit page extraction job ──────────────────────────────────
  fastify.post(
    "/college/:collegeId/student/library/:docId/extract-pages",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };
      const student = getStudent(req);

      const bodySchema = z.object({
        pages:     z.array(z.number().int().positive()).min(1).optional(),
        page_from: z.number().int().positive().optional(),
        page_to:   z.number().int().positive().optional(),
      }).refine(d => d.pages || (d.page_from !== undefined && d.page_to !== undefined), {
        message: "Provide 'pages' array or both 'page_from' and 'page_to'",
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: parsed.error.message });
      }

      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();

      if (!doc)                                      return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false)       return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });
      if (!["pdf", "pptx"].includes(doc.file_type)) {
        return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: "Page extraction only supported for PDF and PPTX" });
      }

      const ok = await checkRateLimit(`rl_pages:${student.sub}`, RATE_LIMITS.page_extractions.max, RATE_LIMITS.page_extractions.window);
      if (!ok) return reply.status(429).send({ statusCode: 429, error: "Too Many Requests", message: "Page extraction limit reached. Try again tomorrow." });

      const { pages: rawPages, page_from, page_to } = parsed.data;
      const pages = rawPages ?? Array.from(
        { length: page_to! - page_from! + 1 },
        (_, i) => page_from! + i,
      );

      if (pages.length > 100) {
        return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: "Cannot extract more than 100 pages at once" });
      }

      const maxPage = doc.file_type === "pptx"
        ? (doc.slide_count ?? 9999)
        : (doc.page_count  ?? 9999);
      if (pages.some(p => p < 1 || p > maxPage)) {
        return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: `Page numbers must be 1–${maxPage}` });
      }

      const jobId = randomUUID();

      await getExtractionJobModel(conn).create({
        _id:             jobId,
        student_id:      student.sub,
        doc_id:          docId,
        college_id:      collegeId,
        job_type:        "extract_pages",
        status:          "pending",
        pages_requested: pages,
      });

      const extractionCallback = `${process.env.API_BASE_URL}/api/v1/internal/extract-jobs/${jobId}/webhook`;
      await enqueueExtractionJob({
        job_id:       jobId,
        doc_id:       docId,
        college_id:   collegeId,
        dept_id:      doc.dept_id,
        file_path:    getEffectiveFilePath(doc),
        file_type:    doc.file_type as "pdf" | "pptx",
        pages,
        job_type:     "extract_pages",
        callback_url: extractionCallback,
      });

      writeLog(conn, {
        collegeId, studentId: student.sub, docId, deptId: doc.dept_id,
        action: "extract_pages", ipAddress: req.ip, userAgent: req.headers["user-agent"],
        pagesExtracted: pages,
      }).catch(() => {});

      return reply.status(202).send({
        job_id:             jobId,
        status:             "pending",
        estimated_seconds:  Math.max(5, Math.ceil(pages.length * 0.4)),
      });
    },
  );

  // ── F-11-E: Poll extraction job ──────────────────────────────────────────
  // Static segment "extract-jobs" takes Fastify routing precedence over :docId
  fastify.get(
    "/college/:collegeId/student/library/extract-jobs/:jobId",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, jobId } = req.params as { collegeId: string; jobId: string };
      const student = getStudent(req);

      const conn = await getCollegeDb(collegeId);
      const job  = await getExtractionJobModel(conn).findById(jobId).lean();

      if (!job)                        return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Job not found" });
      if (job.student_id !== student.sub) return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Access denied" });

      // Completed but token not yet generated — mint it now
      if (job.status === "completed" && !job.output_token && job.output_file_path) {
        if (!fs.existsSync(job.output_file_path)) {
          return reply.send({ status: "failed", error: "Output file missing" });
        }
        const firstPage = job.pages_requested[0];
        const lastPage  = job.pages_requested[job.pages_requested.length - 1];
        const token = await generateFileToken(
          {
            file_path:  job.output_file_path,
            intent:     "download",
            college_id: job.college_id,
            dept_id:    "",
            student_id: student.sub,
            doc_id:     job.doc_id,
            filename:   `pages_${firstPage}-${lastPage}.pdf`,
            mime_type:  "application/pdf",
            single_use: true,
          },
          TOKEN_TTL.extraction,
        );
        await getExtractionJobModel(conn).findByIdAndUpdate(jobId, { $set: { output_token: token } });
        return reply.send({
          status:     "completed",
          token_url:  `/files/serve?token=${token}`,
          expires_at: new Date(Date.now() + TOKEN_TTL.extraction * 1000).toISOString(),
        });
      }

      const res: Record<string, unknown> = { status: job.status };
      if (job.status === "completed" && job.output_token) {
        res.token_url  = `/files/serve?token=${job.output_token}`;
        res.expires_at = job.expires_at?.toISOString() ?? null;
      }
      if (job.status === "failed") res.error = job.error ?? "Extraction failed";

      return reply.send(res);
    },
  );

  // ── F-11-F: AI Summary — SSE streaming ──────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/ai-summary",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };
      const { mode = "brief", page_from, page_to, chapter_index } = req.query as {
        mode?: string; page_from?: string; page_to?: string; chapter_index?: string;
      };
      const student = getStudent(req);

      if (!SUMMARY_PROMPTS[mode]) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "mode must be brief|detailed|key-terms" });
      }

      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();

      if (!doc)                                      return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false)       return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });

      // All validation before SSE headers — rate limit + token limit
      const rlOk = await checkRateLimit(`rl_sum:${student.sub}`, RATE_LIMITS.ai_summaries.max, RATE_LIMITS.ai_summaries.window);
      if (!rlOk) return reply.status(429).send({ statusCode: 429, error: "Too Many Requests", message: "AI summary limit reached. Try again tomorrow." });

      const College = getCollegeModel();
      const college = await College.findById(collegeId).lean();
      if (college && college.tokens_used_this_month >= college.token_limit_per_month) {
        return reply.status(429).send({ statusCode: 429, error: "Too Many Requests", message: "College monthly token limit reached" });
      }

      // Build context — page range uses text cache; full doc uses Pinecone chunks
      let context = "";
      if (page_from || page_to) {
        // Page-range summary from text cache
        if (!doc.text_cache_path || !fs.existsSync(doc.text_cache_path)) {
          return reply.status(503).send({ statusCode: 503, error: "Service Unavailable", message: "Text cache not available for this document" });
        }
        let textData: { pages: Array<{ page_num: number; text: string }> };
        try {
          textData = JSON.parse(fs.readFileSync(doc.text_cache_path, "utf-8"));
        } catch {
          return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message: "Text cache corrupted" });
        }
        const from = page_from ? Number(page_from) : 1;
        const to   = page_to   ? Number(page_to)   : (textData.pages.at(-1)?.page_num ?? 9999);
        const pageTexts = textData.pages
          .filter(p => p.page_num >= from && p.page_num <= to)
          .map(p => `[Page ${p.page_num}]\n${p.text}`);
        if (pageTexts.length === 0) {
          return reply.status(404).send({ statusCode: 404, error: "Not Found", message: `No text found for pages ${from}–${to}` });
        }
        context = pageTexts.join("\n\n").slice(0, AI_SUMMARY_MAX_CONTEXT);
      } else {
        // Full-document summary from Pinecone
        const chunks = await fetchDocChunks(collegeId, doc.dept_id, docId);
        if (chunks.length === 0) {
          return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Document content not yet indexed" });
        }
        context = chunks.map(c => c.text).join("\n\n").slice(0, AI_SUMMARY_MAX_CONTEXT);
      }

      // ── Begin SSE stream ────────────────────────────────────────────────
      // reply.raw.writeHead bypasses Fastify's header map, so CORS headers
      // set by @fastify/cors never reach the socket — must be added manually.
      const reqOrigin = req.headers.origin;
      reply.raw.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        ...(reqOrigin && { "Access-Control-Allow-Origin": reqOrigin }),
        "Access-Control-Allow-Credentials": "true",
      });

      const emit = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

      try {
        const { tokenStream, getUsage } = await streamChatResponse(
          `You are summarising a college curriculum document: "${doc.original_filename}". Be accurate and factual. Only use information from the provided content.`,
          [{ role: "user", content: `${SUMMARY_PROMPTS[mode]}\n\nDocument content:\n\n${context}` }],
          AI_SUMMARY_MODEL,
        );

        let fullContent = "";
        for await (const token of tokenStream) {
          emit({ type: "token", content: token });
          fullContent += token;
        }

        const tokensUsed = await getUsage();
        emit({ type: "done", tokens_used: tokensUsed, source: { doc_id: docId, filename: doc.original_filename } });

        // Fire-and-forget: log + increment college usage
        writeLog(conn, {
          collegeId, studentId: student.sub, docId, deptId: doc.dept_id,
          action: "ai_summary", tokensUsed,
        }).catch(() => {});

        College.updateOne(
          { _id: collegeId },
          { $inc: { tokens_used_this_month: tokensUsed } },
        ).catch(() => {});

        // Persist summary to MongoDB when chapter_index provided
        const chapterIdx = chapter_index !== undefined ? Number(chapter_index) : NaN;
        if (!isNaN(chapterIdx) && fullContent) {
          const ChapterSummary = getChapterSummaryModel(conn);
          ChapterSummary.findOneAndUpdate(
            { student_id: student.sub, doc_id: docId, chapter_index: chapterIdx, mode },
            { $set: { content: fullContent, tokens_used: tokensUsed, college_id: collegeId, generated_at: new Date() } },
            { upsert: true, new: true },
          ).catch(() => {});
        }

      } catch {
        emit({ type: "error", message: "Failed to generate summary" });
      }

      reply.raw.end();
    },
  );
  // ── Saved summary — fetch from MongoDB ──────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/summary",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as { collegeId: string; docId: string; chapterIdx: string };
      const { mode = "brief" } = req.query as { mode?: string };
      const student = getStudent(req);

      if (!["brief", "detailed", "key-terms"].includes(mode)) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "mode must be brief|detailed|key-terms" });
      }

      const conn = await getCollegeDb(collegeId);
      const ChapterSummary = getChapterSummaryModel(conn);
      const saved = await ChapterSummary.findOne({
        student_id: student.sub,
        doc_id: docId,
        chapter_index: Number(chapterIdx),
        mode,
      }).lean();

      if (!saved) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "No saved summary" });
      }

      return reply.send({
        content:      saved.content,
        mode:         saved.mode,
        tokens_used:  saved.tokens_used,
        generated_at: saved.generated_at,
      });
    },
  );

  // ── F-13-C: Chapter chat — create/get session ───────────────────────────────
  fastify.post(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/chat/session",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as { collegeId: string; docId: string; chapterIdx: string };
      const student = getStudent(req);
      const chapterIndex = Number(chapterIdx);

      const conn     = await getCollegeDb(collegeId);
      const Document = getDocumentModel(conn);
      const doc      = await Document.findById(docId).lean();

      if (!doc || doc.is_visible_to_students === false) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Document not found" });
      }

      // Project only the matching chapter — avoids loading all chunk_ids
      const ChapterMap = getChapterMapModel(conn);
      const [chapterSlice] = await ChapterMap.aggregate<{ title: string }>([
        { $match: { doc_id: docId } },
        { $project: { chapters: { $filter: { input: "$chapters", as: "ch", cond: { $eq: ["$$ch.chapter_index", chapterIndex] } } } } },
        { $unwind: "$chapters" },
        { $replaceRoot: { newRoot: "$chapters" } },
        { $limit: 1 },
      ]);
      if (!chapterSlice) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Chapter not found" });
      }

      const Session = getSessionModel(conn);

      // Find most recent session for this student+doc+chapter
      const existing = await Session.findOne(
        { student_id: student.sub, doc_id: docId, chapter_index: chapterIndex },
      ).sort({ last_active: -1 }).lean();

      if (existing) {
        return reply.status(200).send({
          session_id:    existing._id,
          chapter_index: chapterIndex,
          chapter_title: chapterSlice.title,
          chat_mode:     existing.chat_mode ?? "answer",
          messages:      existing.messages ?? [],
        });
      }

      const session = await Session.create({
        _id:           randomUUID(),
        student_id:    student.sub,
        college_id:    collegeId,
        dept_id:       doc.dept_id,
        doc_id:        docId,
        chapter_index: chapterIndex,
        chat_mode:     "answer",
        messages:      [],
      });

      return reply.status(201).send({
        session_id:    session._id,
        chapter_index: chapterIndex,
        chapter_title: chapterSlice.title,
        chat_mode:     "answer",
        messages:      [],
      });
    },
  );

  // ── F-13-C: Chapter chat — send message (SSE) ────────────────────────────
  fastify.post(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/chat/:sessionId/message",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx, sessionId } = req.params as {
        collegeId: string; docId: string; chapterIdx: string; sessionId: string;
      };
      const student = getStudent(req);
      const chapterIndex = Number(chapterIdx);

      const bodyParsed = z.object({ message: z.string().min(1).max(2000) }).safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "message required (max 2000 chars)" });
      }
      const { message } = bodyParsed.data;

      const reqOrigin = req.headers.origin;
      reply.raw.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "X-Accel-Buffering": "no",
        ...(reqOrigin && { "Access-Control-Allow-Origin": reqOrigin }),
        "Access-Control-Allow-Credentials": "true",
      });

      const sendSSE = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

      try {
        const conn       = await getCollegeDb(collegeId);
        const Session    = getSessionModel(conn);
        const Document   = getDocumentModel(conn);
        const ChapterMap = getChapterMapModel(conn);

        const [session, doc, chapterMap] = await Promise.all([
          Session.findOne({ _id: sessionId, student_id: student.sub }).lean(),
          Document.findById(docId).lean(),
          ChapterMap.findOne({ doc_id: docId }).lean(),
        ]);

        if (!session || !doc || !chapterMap) {
          sendSSE({ type: "error", message: "Session, document, or chapter map not found" });
          reply.raw.end();
          return;
        }

        const chapter = chapterMap.chapters.find(c => c.chapter_index === chapterIndex);
        if (!chapter) {
          sendSSE({ type: "error", message: "Chapter not found" });
          reply.raw.end();
          return;
        }

        const sessionMessages = session.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
        let fullResponse = "";
        let ragDone: { sources: unknown[]; confidence_score: number; answered: boolean; tokens_used: number } | null = null;

        for await (const event of runChapterRAG({
          query: message,
          collegeId,
          deptId: doc.dept_id,
          docId,
          chapter: chapter as Parameters<typeof runChapterRAG>[0]["chapter"],
          sessionMessages,
          mode: (session.chat_mode ?? "answer") as "answer" | "socratic",
          allChapters: chapterMap.chapters as Parameters<typeof runChapterRAG>[0]["allChapters"],
        })) {
          sendSSE(event);
          if (event.type === "token") fullResponse += event.content;
          else if (event.type === "fallback") fullResponse = event.message;
          else if (event.type === "done") ragDone = event;
        }

        const { sources = [], confidence_score = 0, answered = false, tokens_used = 0 } = ragDone ?? {};

        // Persist messages to session
        await Session.findByIdAndUpdate(sessionId, {
          $push: {
            messages: {
              $each: [
                { role: "user",      content: message,       sources: [], answered: true },
                { role: "assistant", content: fullResponse,  sources, confidence_score, answered },
              ],
            },
          },
          $set: { last_active: new Date() },
        });

        // Fire-and-forget token counter
        if (tokens_used > 0) {
          getCollegeModel().findByIdAndUpdate(collegeId, {
            $inc: { tokens_used_this_month: tokens_used },
          }).catch(() => {});
        }
      } catch (err) {
        fastify.log.error({ err }, "Chapter chat error");
        sendSSE({ type: "error", message: err instanceof Error ? err.message : "Internal server error" });
      }

      reply.raw.end();
    },
  );

  // ── F-13-G: Switch chat mode (answer ↔ socratic) ────────────────────────
  fastify.patch(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/chat/:sessionId/mode",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, sessionId } = req.params as { collegeId: string; docId: string; chapterIdx: string; sessionId: string };
      const student = getStudent(req);

      const bodyParsed = z.object({ mode: z.enum(["answer", "socratic"]) }).safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "mode must be 'answer' or 'socratic'" });
      }

      const conn    = await getCollegeDb(collegeId);
      const Session = getSessionModel(conn);
      const session = await Session.findOneAndUpdate(
        { _id: sessionId, student_id: student.sub },
        { $set: { chat_mode: bodyParsed.data.mode } },
        { new: true },
      ).lean();

      if (!session) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Session not found" });
      }

      return reply.send({ session_id: sessionId, chat_mode: session.chat_mode });
    },
  );

  // ── F-13-B: Chapter map for a document ─────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/chapters",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };

      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();

      if (!doc)                                 return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false) return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });

      if (!doc.has_chapter_map) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Chapter map not yet available for this document" });
      }

      const ChapterMap = getChapterMapModel(conn);
      const chapterMap = await ChapterMap.findOne({ doc_id: docId }).lean();

      if (!chapterMap) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Chapter map not found" });
      }

      return reply.send({
        doc_id:            docId,
        doc_name:          doc.original_filename,
        total_chapters:    chapterMap.total_chapters,
        total_pages:       chapterMap.total_pages,
        extraction_method: chapterMap.extraction_method,
        confidence:        chapterMap.confidence_score,
        chapters:          chapterMap.chapters.map(ch => ({
          chapter_index:      ch.chapter_index,
          title:              ch.title,
          subtitle:           ch.subtitle ?? "",
          start_page:         ch.start_page,
          end_page:           ch.end_page,
          page_count:         ch.page_count,
          chunk_count:        ch.chunk_count,
          pyq_count:          ch.pyq_count,
          pyq_years:          ch.pyq_years,
          pyq_coverage_score: ch.pyq_coverage_score,
        })),
      });
    },
  );

  // ── F-13-H: Study Notes ──────────────────────────────────────────────────

  // GET notes for a chapter
  fastify.get(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/notes",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as {
        collegeId: string; docId: string; chapterIdx: string;
      };
      const student = getStudent(req);
      const conn    = await getCollegeDb(collegeId);

      const StudentNotes = getStudentNotesModel(conn);
      const doc = await StudentNotes.findOne({
        student_id: student.sub,
        doc_id:     docId,
        chapter_index: Number(chapterIdx),
      }).lean();

      return reply.send({ notes: doc?.notes ?? [] });
    },
  );

  // POST create / append note
  fastify.post(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/notes",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as {
        collegeId: string; docId: string; chapterIdx: string;
      };
      const student = getStudent(req);
      const body    = req.body as {
        content?: string;
        source_page?: number;
        pinned_ai_response?: string;
      };

      if (!body?.content && !body?.pinned_ai_response) {
        return reply.code(400).send({ error: "content or pinned_ai_response required" });
      }

      const conn  = await getCollegeDb(collegeId);
      const StudentNotes = getStudentNotesModel(conn);

      const note = {
        note_id:            randomUUID(),
        content:            body.content ?? "",
        source_page:        body.source_page,
        pinned_ai_response: body.pinned_ai_response,
        created_at:         new Date(),
        updated_at:         new Date(),
      };

      await StudentNotes.findOneAndUpdate(
        { student_id: student.sub, doc_id: docId, chapter_index: Number(chapterIdx) },
        {
          $setOnInsert: {
            _id:        randomUUID(),
            college_id: collegeId,
          },
          $push: { notes: note },
        },
        { upsert: true, new: true },
      );

      return reply.code(201).send({ note });
    },
  );

  // DELETE a specific note
  fastify.delete(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/notes/:noteId",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx, noteId } = req.params as {
        collegeId: string; docId: string; chapterIdx: string; noteId: string;
      };
      const student = getStudent(req);
      const conn    = await getCollegeDb(collegeId);

      const StudentNotes = getStudentNotesModel(conn);
      await StudentNotes.updateOne(
        { student_id: student.sub, doc_id: docId, chapter_index: Number(chapterIdx) },
        { $pull: { notes: { note_id: noteId } } },
      );

      return reply.send({ ok: true });
    },
  );

  // GET export notes as plain text
  fastify.get(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/notes/export",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as {
        collegeId: string; docId: string; chapterIdx: string;
      };
      const student = getStudent(req);
      const conn    = await getCollegeDb(collegeId);

      const StudentNotes = getStudentNotesModel(conn);
      const doc = await StudentNotes.findOne({
        student_id:    student.sub,
        doc_id:        docId,
        chapter_index: Number(chapterIdx),
      }).lean();

      const notes = doc?.notes ?? [];
      const lines = notes.map((n, i) => {
        const parts: string[] = [`${i + 1}. ${n.content}`];
        if (n.source_page)        parts.push(`   Page: ${n.source_page}`);
        if (n.pinned_ai_response) parts.push(`   AI Answer: ${n.pinned_ai_response}`);
        return parts.join("\n");
      });

      const text = lines.length > 0
        ? `Chapter ${chapterIdx} Notes\n${"=".repeat(40)}\n\n${lines.join("\n\n")}`
        : "No notes for this chapter.";

      return reply
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="chapter_${chapterIdx}_notes.txt"`)
        .send(text);
    },
  );

  // ── F-17-F: Image gallery for a document ─────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/images",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId } = req.params as { collegeId: string; docId: string };
      const q = req.query as {
        page?: string; limit?: string; image_type?: string;
        source_page_from?: string; source_page_to?: string; q?: string;
      };
      const student = getStudent(req);
      const page  = Math.max(1, Number(q.page  ?? 1));
      const limit = Math.min(100, Math.max(1, Number(q.limit ?? 24)));

      const conn = await getCollegeDb(collegeId);
      const doc  = await getDocumentModel(conn).findById(docId).lean();
      if (!doc)                                 return reply.status(404).send({ statusCode: 404, error: "Not Found",  message: "Document not found" });
      if (doc.is_visible_to_students === false) return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Document not available" });

      const ImageAsset = getImageAssetModel(conn);
      const filter: Record<string, unknown> = { doc_id: docId, was_filtered: false, hidden: { $ne: true } };

      if (q.image_type) filter.image_type = q.image_type;
      if (q.source_page_from || q.source_page_to) {
        filter.source_page = {
          ...(q.source_page_from ? { $gte: Number(q.source_page_from) } : {}),
          ...(q.source_page_to   ? { $lte: Number(q.source_page_to) }   : {}),
        };
      }
      if (q.q) {
        filter.$or = [
          { caption:       { $regex: q.q, $options: "i" } },
          { labels_extracted: { $regex: q.q, $options: "i" } },
          { description:   { $regex: q.q, $options: "i" } },
        ];
      }

      const allAssets = await ImageAsset.find(filter as never).sort({ global_image_index: 1 }).lean();
      const total     = allAssets.length;
      const pageAssets = allAssets.slice((page - 1) * limit, page * limit);

      const byType: Record<string, number> = {};
      for (const asset of allAssets) {
        const t = asset.image_type ?? "other";
        byType[t] = (byType[t] ?? 0) + 1;
      }

      const images = await Promise.all(
        pageAssets.map(async (asset) => {
          const [token, thumbToken] = await Promise.all([
            generateFileToken(
              { file_path: asset.file_path, intent: "preview", college_id: collegeId, dept_id: asset.dept_id, student_id: student.sub, doc_id: docId, filename: `image_${asset._id}.jpg`, mime_type: "image/jpeg", single_use: false },
              TOKEN_TTL.preview,
            ),
            generateFileToken(
              { file_path: asset.thumbnail_path, intent: "preview", college_id: collegeId, dept_id: asset.dept_id, student_id: student.sub, doc_id: docId, filename: `image_${asset._id}_thumb.jpg`, mime_type: "image/jpeg", single_use: false },
              TOKEN_TTL.preview,
            ),
          ]);
          return {
            image_asset_id: asset._id,
            token_url: `/files/serve?token=${token}`,
            thumbnail_url: `/files/serve?token=${thumbToken}`,
            caption: asset.caption ?? "",
            image_type: asset.image_type ?? "other",
            source_page: asset.source_page,
            labels: asset.labels_extracted ?? [],
            alt_text: asset.alt_text ?? "",
          };
        }),
      );

      return reply.send({
        images,
        total,
        by_type: byType,
        pagination: { page, limit, total_pages: Math.ceil(total / limit) },
      });
    },
  );
};

export const libraryRoutes = libraryRoutesPlugin;
