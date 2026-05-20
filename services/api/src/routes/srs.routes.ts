import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { getCollegeDb } from "../db/college.db";
import { getSrsCardModel } from "../models/college/srs-card.model";
import { getStudentModel } from "../models/college/student.model";
import {
  getDueTodayCards,
  reviewCard,
  addManualCard,
  getSRSStats,
} from "../services/srs.service";
import type { StudentJWTPayload } from "@college-chatbot/shared";

function getStudent(req: FastifyRequest): StudentJWTPayload {
  return req.user as StudentJWTPayload;
}

const ReviewSchema = z.object({
  card_id:            z.string().min(1),
  quality:            z.number().int().min(0).max(5),
  student_answer:     z.string().default(""),
  time_taken_seconds: z.number().int().min(0).default(0),
});

const AddCardSchema = z.object({
  question_text:  z.string().min(1),
  question_type:  z.enum(["MCQ", "TF", "SAQ", "CASE", "MIXED"]).default("SAQ"),
  correct_answer: z.string().min(1),
  explanation:    z.string().default(""),
  source_page:    z.number().int().positive().optional(),
  doc_id:         z.string().min(1),
  chapter_index:  z.number().int().min(0),
  subject_id:     z.string().min(1),
  dept_id:        z.string().min(1),
  bloom_level:    z.string().default("understand"),
});

const srsRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const PRE = [verifyJWT, resolveCollege, requireRole("student")];

  // ── Due today ──────────────────────────────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/srs/due-today",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const result = await getDueTodayCards(student.sub, collegeId, conn);
      return reply.send(result);
    },
  );

  // ── Stats ──────────────────────────────────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/srs/stats",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const stats = await getSRSStats(student.sub, conn);
      return reply.send(stats);
    },
  );

  // ── Submit review ──────────────────────────────────────────────────────────
  fastify.post(
    "/college/:collegeId/student/srs/review",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const body = ReviewSchema.parse(req.body ?? {});

      const result = await reviewCard(
        {
          cardId:            body.card_id,
          quality:           body.quality,
          studentAnswer:     body.student_answer,
          timeTakenSeconds:  body.time_taken_seconds,
          studentId:         student.sub,
          collegeId,
        },
        conn,
      );
      return reply.send(result);
    },
  );

  // ── Add card manually ──────────────────────────────────────────────────────
  fastify.post(
    "/college/:collegeId/student/srs/add-card",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const body = AddCardSchema.parse(req.body ?? {});

      const result = await addManualCard(
        {
          studentId:     student.sub,
          collegeId,
          deptId:        body.dept_id,
          docId:         body.doc_id,
          chapterIndex:  body.chapter_index,
          subjectId:     body.subject_id,
          questionText:  body.question_text,
          questionType:  body.question_type,
          correctAnswer: body.correct_answer,
          explanation:   body.explanation,
          sourcePage:    body.source_page,
          bloomLevel:    body.bloom_level,
        },
        conn,
      );
      return reply.code(201).send(result);
    },
  );

  // ── Suspend card ───────────────────────────────────────────────────────────
  fastify.patch(
    "/college/:collegeId/student/srs/cards/:cardId/suspend",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, cardId } = req.params as { collegeId: string; cardId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const SrsCard = getSrsCardModel(conn);
      const result = await SrsCard.updateOne(
        { _id: cardId, student_id: student.sub },
        { $set: { status: "suspended" } },
      );
      if (result.matchedCount === 0) return reply.code(404).send({ error: "Card not found" });
      return reply.send({ ok: true });
    },
  );

  // ── Reactivate card ────────────────────────────────────────────────────────
  fastify.patch(
    "/college/:collegeId/student/srs/cards/:cardId/reactivate",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, cardId } = req.params as { collegeId: string; cardId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const SrsCard = getSrsCardModel(conn);
      const result = await SrsCard.updateOne(
        { _id: cardId, student_id: student.sub },
        { $set: { status: "active" } },
      );
      if (result.matchedCount === 0) return reply.code(404).send({ error: "Card not found" });
      return reply.send({ ok: true });
    },
  );

  // ── Delete card ────────────────────────────────────────────────────────────
  fastify.delete(
    "/college/:collegeId/student/srs/cards/:cardId",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, cardId } = req.params as { collegeId: string; cardId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const SrsCard = getSrsCardModel(conn);
      const result = await SrsCard.deleteOne({ _id: cardId, student_id: student.sub });
      if (result.deletedCount === 0) return reply.code(404).send({ error: "Card not found" });

      await getStudentModel(conn).updateOne(
        { _id: student.sub },
        { $inc: { srs_total_cards: -1 } },
      );

      return reply.send({ ok: true });
    },
  );
};

export const srsRoutes: FastifyPluginAsync = srsRoutesPlugin;
