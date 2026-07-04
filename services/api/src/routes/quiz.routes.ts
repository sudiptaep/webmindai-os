import { randomUUID } from "crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { getQuizSessionModel } from "../models/college/quiz-session.model";
import {
  generateQuiz,
  submitSingleAnswer,
  computeExamReadiness,
} from "../services/quiz.service";
import { addCorrectAnswersToSRS } from "../services/srs.service";
import { getImageAssetModel } from "../models/college/image-asset.model";
import { generateFileToken, TOKEN_TTL } from "../services/file-token.service";
import type { Connection } from "mongoose";
import type { StudentJWTPayload, QuizQuestion } from "@college-chatbot/shared";

function getStudent(req: FastifyRequest): StudentJWTPayload {
  return req.user as StudentJWTPayload;
}

// IMAGE_LABEL questions store only image_asset_id — resolve a fresh preview token per request
async function attachImageTokens(
  questions: QuizQuestion[],
  collegeId: string,
  studentId: string,
  conn: Connection,
): Promise<Array<QuizQuestion & { image_token_url?: string }>> {
  const imageQuestions = questions.filter((q) => q.question_type === "IMAGE_LABEL" && q.image_asset_id);
  if (imageQuestions.length === 0) return questions;

  const ImageAsset = getImageAssetModel(conn);
  const tokenMap = new Map<string, string>();
  await Promise.all(
    imageQuestions.map(async (q) => {
      const asset = await ImageAsset.findById(q.image_asset_id).lean();
      if (!asset) return;
      const token = await generateFileToken(
        { file_path: asset.file_path, intent: "preview", college_id: collegeId, dept_id: asset.dept_id, student_id: studentId, doc_id: asset.doc_id, filename: `image_${asset._id}.jpg`, mime_type: "image/jpeg", single_use: false },
        TOKEN_TTL.preview,
      );
      tokenMap.set(q.image_asset_id!, `/files/serve?token=${token}`);
    }),
  );

  return questions.map((q) =>
    q.image_asset_id && tokenMap.has(q.image_asset_id)
      ? { ...q, image_token_url: tokenMap.get(q.image_asset_id) }
      : q,
  );
}

const GenerateSchema = z.object({
  question_type:          z.enum(["MCQ", "TF", "SAQ", "CASE", "MIXED", "IMAGE_LABEL"]).default("MCQ"),
  difficulty:             z.enum(["recall", "application", "analysis", "adaptive"]).default("application"),
  count:                  z.number().int().min(1).max(40).default(10),
  include_pyq:            z.boolean().default(false),
  timed:                  z.boolean().default(false),
  time_limit_per_question:z.number().int().min(10).max(300).optional(),
});

const AnswerSchema = z.object({
  question_id:    z.string(),
  student_answer: z.string(),
});

const quizRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const PRE = [verifyJWT, resolveCollege, requireRole("student")];

  // ── Generate quiz for a chapter ──────────────────────────────────────────
  fastify.post(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/quiz",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as {
        collegeId: string; docId: string; chapterIdx: string;
      };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      // Validate doc exists and belongs to student's dept
      const Document = getDocumentModel(conn);
      const doc = await Document.findById(docId).lean();
      if (!doc) return reply.code(404).send({ error: "Document not found" });
      if (!doc.has_chapter_map) return reply.code(400).send({ error: "No chapter map for this document" });

      const body = GenerateSchema.parse(req.body ?? {});

      const result = await generateQuiz({
        collegeId,
        deptId:     doc.dept_id,
        docId,
        chapterIndex: Number(chapterIdx),
        studentId:  student.sub,
        subjectId:  doc.subject_id ?? "",
        questionType: body.question_type as import("@college-chatbot/shared").QuizQuestionType,
        difficulty:   body.difficulty  as import("@college-chatbot/shared").QuizDifficulty,
        count:          body.count,
        includePyq:     body.include_pyq,
        timed:          body.timed,
        timeLimitPerQuestion: body.time_limit_per_question,
        conn,
      });

      const questions = await attachImageTokens(result.questions, collegeId, student.sub, conn);
      return reply.send({ ...result, questions });
    },
  );

  // ── Get quiz session ──────────────────────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/quiz-sessions/:sessionId",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, sessionId } = req.params as { collegeId: string; sessionId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const QuizSession = getQuizSessionModel(conn);
      const session = await QuizSession.findById(sessionId).lean();
      if (!session) return reply.code(404).send({ error: "Session not found" });
      if (session.student_id !== student.sub) return reply.code(403).send({ error: "Forbidden" });

      const questions = await attachImageTokens(session.questions, collegeId, student.sub, conn);
      return reply.send({ ...session, questions });
    },
  );

  // ── Submit single answer (practice mode) ─────────────────────────────────
  fastify.post(
    "/college/:collegeId/student/quiz-sessions/:sessionId/answer",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, sessionId } = req.params as { collegeId: string; sessionId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      // Ownership check
      const QuizSession = getQuizSessionModel(conn);
      const session = await QuizSession.findById(sessionId).lean();
      if (!session) return reply.code(404).send({ error: "Session not found" });
      if (session.student_id !== student.sub) return reply.code(403).send({ error: "Forbidden" });
      if (session.status === "completed") return reply.code(400).send({ error: "Session already completed" });

      const { question_id, student_answer } = AnswerSchema.parse(req.body ?? {});

      const result = await submitSingleAnswer(sessionId, question_id, student_answer, conn);
      return reply.send(result);
    },
  );

  // ── Submit all answers and finalize (test mode) ───────────────────────────
  fastify.post(
    "/college/:collegeId/student/quiz-sessions/:sessionId/submit",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, sessionId } = req.params as { collegeId: string; sessionId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const QuizSession = getQuizSessionModel(conn);
      const session = await QuizSession.findById(sessionId).lean();
      if (!session) return reply.code(404).send({ error: "Session not found" });
      if (session.student_id !== student.sub) return reply.code(403).send({ error: "Forbidden" });
      if (session.status === "completed") return reply.code(400).send({ error: "Already submitted" });

      // Batch answers provided in body
      const body = req.body as { answers?: Array<{ question_id: string; student_answer: string }> } | null;
      if (body?.answers?.length) {
        await Promise.all(
          body.answers.map(a => submitSingleAnswer(sessionId, a.question_id, a.student_answer, conn)),
        );
      }

      const result = await computeExamReadiness(sessionId, conn);

      // Fire-and-forget — add correct answers to SRS deck (non-blocking)
      addCorrectAnswersToSRS(sessionId, student.sub, collegeId, conn);

      return reply.send(result);
    },
  );

  // ── Get quiz results / exam readiness ────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/quiz-sessions/:sessionId/results",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, sessionId } = req.params as { collegeId: string; sessionId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const QuizSession = getQuizSessionModel(conn);
      const session = await QuizSession.findById(sessionId).lean();
      if (!session) return reply.code(404).send({ error: "Session not found" });
      if (session.student_id !== student.sub) return reply.code(403).send({ error: "Forbidden" });

      if (session.status !== "completed") {
        // Compute now if not already done
        const result = await computeExamReadiness(sessionId, conn);
        return reply.send(result);
      }

      return reply.send({
        score_pct:            session.score_pct            ?? 0,
        correct_count:        session.correct_count        ?? 0,
        total_count:          session.total_count,
        weak_topics:          session.weak_topics          ?? [],
        strong_topics:        session.strong_topics        ?? [],
        pyq_coverage_pct:     session.pyq_coverage_pct     ?? 0,
        pyq_would_pass_count: session.pyq_would_pass_count ?? 0,
        recommendation:       session.recommendation       ?? "",
      });
    },
  );

  // ── Quiz history for a chapter ────────────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/quiz-history",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const student = getStudent(req);
      const q = req.query as { docId?: string; chapterIdx?: string; limit?: string };
      const conn = await getCollegeDb(collegeId);

      const QuizSession = getQuizSessionModel(conn);
      const filter: Record<string, unknown> = { student_id: student.sub };
      if (q.docId)      filter.doc_id        = q.docId;
      if (q.chapterIdx) filter.chapter_index = Number(q.chapterIdx);

      const sessions = await QuizSession.find(filter)
        .sort({ started_at: -1 })
        .limit(Number(q.limit ?? 20))
        .select("_id doc_id chapter_index quiz_mode question_type difficulty status total_count score_pct started_at completed_at time_limit_seconds")
        .lean();

      return reply.send({ sessions });
    },
  );
};

export const quizRoutes: FastifyPluginAsync = quizRoutesPlugin;
