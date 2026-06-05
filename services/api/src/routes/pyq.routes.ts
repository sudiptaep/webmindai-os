import { randomUUID } from "crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { requireDeptScope } from "../middleware/checkDeptScope";
import { getCollegeDb } from "../db/college.db";
import { getPYQPaperModel } from "../models/college/pyq-paper.model";
import { getPYQQuestionModel } from "../models/college/pyq-question.model";
import { getChapterMapModel } from "../models/college/chapter-map.model";
import { uploadFile, buildDocumentKey, resolveLocalPath } from "../services/storage.service";
import { enqueuePYQIngestionJob } from "../services/queue.service";
import { isDeptAdmin } from "@college-chatbot/shared";
import type { StudentJWTPayload } from "@college-chatbot/shared";

function getStudent(req: FastifyRequest): StudentJWTPayload {
  return req.user as StudentJWTPayload;
}

const pyqRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const ADMIN_PRE  = [verifyJWT, resolveCollege, requireRole("dept_admin", "super_admin")];
  const STUDENT_PRE = [verifyJWT, resolveCollege, requireRole("student")];

  // ── Admin: upload a PYQ paper ────────────────────────────────────────────
  fastify.post(
    "/college/:collegeId/admin/pyq/upload",
    {
      preHandler: [
        ...ADMIN_PRE,
        requireDeptScope((req) => (req.body as Record<string, string>)?.dept_id ?? ""),
      ],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };

      const parts = req.parts();
      let deptId: string | undefined;
      let subjectId: string | undefined;
      let year: string | undefined;
      let month: string | undefined;
      let examName: string | undefined;
      let university: string | undefined;
      let fileBuffer: Buffer | undefined;
      let filename: string | undefined;

      for await (const part of parts) {
        if (part.type === "field") {
          if      (part.fieldname === "dept_id")    deptId    = part.value as string;
          else if (part.fieldname === "subject_id") subjectId = part.value as string;
          else if (part.fieldname === "year")       year      = part.value as string;
          else if (part.fieldname === "month")      month     = part.value as string;
          else if (part.fieldname === "exam_name")  examName  = part.value as string;
          else if (part.fieldname === "university") university= part.value as string;
        } else if (part.type === "file" && part.fieldname === "file") {
          filename   = part.filename;
          fileBuffer = await part.toBuffer();
        }
      }

      if (!deptId)     return reply.code(400).send({ error: "dept_id required" });
      if (!year)       return reply.code(400).send({ error: "year required" });
      if (!examName)   return reply.code(400).send({ error: "exam_name required" });
      if (!fileBuffer || !filename) return reply.code(400).send({ error: "file required" });

      const ext = filename.split(".").pop()?.toLowerCase();
      if (ext !== "pdf") return reply.code(400).send({ error: "Only PDF files accepted" });

      if (fileBuffer.byteLength > 50 * 1024 * 1024)
        return reply.code(413).send({ error: "File exceeds 50 MB limit" });

      if (isDeptAdmin(req.user) && req.user.dept_id !== deptId)
        return reply.code(403).send({ error: "Dept scope not permitted" });

      const docId      = randomUUID();
      const paperId    = randomUUID();
      const fileKey    = buildDocumentKey(collegeId, deptId, docId, filename);
      const filePath   = resolveLocalPath(fileKey);
      const namespace  = `c_${collegeId}_d_${deptId}_pyq`;

      await uploadFile(fileKey, fileBuffer, "pdf");

      const conn    = await getCollegeDb(collegeId);
      const PYQPaper = getPYQPaperModel(conn);
      await PYQPaper.create({
        _id:               paperId,
        college_id:        collegeId,
        dept_id:           deptId,
        subject_id:        subjectId ?? null,
        year,
        month,
        exam_name:         examName,
        university,
        doc_id:            docId,
        file_path:         filePath,
        ingestion_status:  "pending",
        pinecone_namespace: namespace,
      });

      const apiBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
      await enqueuePYQIngestionJob({
        job_id:       paperId,
        pyq_paper_id: paperId,
        doc_id:       docId,
        college_id:   collegeId,
        dept_id:      deptId,
        subject_id:   subjectId ?? undefined,
        file_path:    filePath,
        year,
        month,
        exam_name:    examName,
        university,
        callback_url: `${apiBase}/api/v1/internal/ingest/pyq/${paperId}/webhook`,
        job_type:     "ingest_pyq",
      });

      return reply.code(202).send({ pyq_paper_id: paperId, status: "pending" });
    },
  );

  // ── Admin: list PYQ papers for a dept ────────────────────────────────────
  fastify.get(
    "/college/:collegeId/admin/pyq",
    { preHandler: ADMIN_PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const q = req.query as { dept_id?: string; subject_id?: string };
      const conn = await getCollegeDb(collegeId);

      const filter: Record<string, unknown> = { college_id: collegeId };
      if (q.dept_id)    filter.dept_id    = q.dept_id;
      if (q.subject_id) filter.subject_id = q.subject_id;

      const PYQPaper = getPYQPaperModel(conn);
      const papers = await PYQPaper.find(filter).sort({ year: -1 }).lean();
      return reply.send({ papers });
    },
  );

  // ── Admin: trigger PYQ → chapter re-mapping ──────────────────────────────
  fastify.post(
    "/college/:collegeId/admin/pyq/:pyqPaperId/remap",
    { preHandler: ADMIN_PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, pyqPaperId } = req.params as { collegeId: string; pyqPaperId: string };
      const conn    = await getCollegeDb(collegeId);
      const PYQPaper = getPYQPaperModel(conn);
      const paper   = await PYQPaper.findById(pyqPaperId).lean();
      if (!paper) return reply.code(404).send({ error: "PYQ paper not found" });

      const apiBase = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
      await enqueuePYQIngestionJob({
        job_id:       randomUUID(),
        pyq_paper_id: pyqPaperId,
        doc_id:       paper.doc_id,
        college_id:   collegeId,
        dept_id:      paper.dept_id,
        subject_id:   paper.subject_id,
        file_path:    paper.file_path,
        year:         paper.year,
        month:        paper.month,
        exam_name:    paper.exam_name,
        university:   paper.university,
        callback_url: `${apiBase}/api/v1/internal/ingest/pyq/${pyqPaperId}/webhook`,
        job_type:     "ingest_pyq",
      });

      return reply.send({ status: "queued" });
    },
  );

  // ── Student: list PYQ questions for a chapter ────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/pyq",
    { preHandler: STUDENT_PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as {
        collegeId: string; docId: string; chapterIdx: string;
      };
      const conn = await getCollegeDb(collegeId);

      // Look up chapter pyq_question_ids from chapter map
      const ChapterMap = getChapterMapModel(conn);
      const chapterMap = await ChapterMap.findOne({ doc_id: docId }).lean();
      if (!chapterMap) return reply.code(404).send({ error: "Chapter map not found" });

      const chapter = chapterMap.chapters.find(c => c.chapter_index === Number(chapterIdx));
      if (!chapter) return reply.code(404).send({ error: "Chapter not found" });

      if (!chapter.pyq_question_ids?.length) {
        return reply.send({ questions: [], years_covered: [], total_count: 0 });
      }

      const PYQQuestion = getPYQQuestionModel(conn);
      const questions = await PYQQuestion.find({
        _id: { $in: chapter.pyq_question_ids },
      })
        .sort({ year: -1, marks: -1 })
        .lean();

      const yearSet = new Set(questions.map(q => q.year));

      return reply.send({
        questions,
        years_covered: Array.from(yearSet).sort().reverse(),
        total_count:   questions.length,
      });
    },
  );
};

export const pyqRoutes: FastifyPluginAsync = pyqRoutesPlugin;
