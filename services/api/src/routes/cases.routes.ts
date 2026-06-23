import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { getClinicalCaseModel } from "../models/college/clinical-case.model";
import { generateClinicalCase, listChapterCases } from "../services/clinical-case.service";
import { addManualCard } from "../services/srs.service";
import type { StudentJWTPayload, CaseQuestionType, CaseDifficulty } from "@college-chatbot/shared";

function getStudent(req: FastifyRequest): StudentJWTPayload {
  return req.user as StudentJWTPayload;
}

const GenerateCaseSchema = z.object({
  question_type: z
    .enum(["diagnosis", "management", "investigation", "mechanism", "complication"])
    .default("diagnosis"),
  difficulty: z.enum(["recall", "application", "analysis"]).default("application"),
});

const casesRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const PRE = [verifyJWT, resolveCollege, requireRole("student")];

  // ── Generate clinical case ─────────────────────────────────────────────────
  fastify.post(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/cases/generate",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as {
        collegeId: string; docId: string; chapterIdx: string;
      };
      const conn = await getCollegeDb(collegeId);

      // Validate doc exists
      const Document = getDocumentModel(conn);
      const doc = await Document.findById(docId).lean();
      if (!doc) return reply.code(404).send({ error: "Document not found" });

      const body = GenerateCaseSchema.parse(req.body ?? {});

      try {
        const result = await generateClinicalCase({
          docId,
          chapterIndex:  Number(chapterIdx),
          questionType:  body.question_type as CaseQuestionType,
          difficulty:    body.difficulty as CaseDifficulty,
          collegeId,
          deptId:        doc.dept_id,
          conn,
        });
        return reply.send(result);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("No content indexed")) {
          return reply.code(422).send({ error: msg });
        }
        if (msg.includes("parse failed")) {
          return reply.code(422).send({ error: "Case generation failed — AI response malformed. Try again." });
        }
        throw err;
      }
    },
  );

  // ── List cached cases for a chapter ───────────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/library/:docId/chapters/:chapterIdx/cases",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, docId, chapterIdx } = req.params as {
        collegeId: string; docId: string; chapterIdx: string;
      };
      const conn = await getCollegeDb(collegeId);

      const result = await listChapterCases(docId, Number(chapterIdx), conn);
      return reply.send(result);
    },
  );

  // ── Add case to SRS deck ───────────────────────────────────────────────────
  fastify.post(
    "/college/:collegeId/student/cases/:caseId/add-to-srs",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, caseId } = req.params as { collegeId: string; caseId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const ClinicalCase = getClinicalCaseModel(conn);
      const clinicalCase = await ClinicalCase.findById(caseId).lean();
      if (!clinicalCase) return reply.code(404).send({ error: "Case not found" });

      // Convert case to SAQ/CASE-type SRS card
      // question = case_text + "\n\n" + question
      // answer   = expected_answer
      const result = await addManualCard(
        {
          studentId:     student.sub,
          collegeId,
          deptId:        clinicalCase.dept_id,
          docId:         clinicalCase.doc_id,
          chapterIndex:  clinicalCase.chapter_index,
          subjectId:     clinicalCase.subject_id,
          questionText:  `${clinicalCase.case_text}\n\n${clinicalCase.question}`,
          questionType:  "CASE",
          correctAnswer: clinicalCase.expected_answer,
          explanation:   clinicalCase.key_teaching_points.join(" | "),
          sourcePage:    clinicalCase.source_pages[0],
          bloomLevel:    clinicalCase.bloom_level,
        },
        conn,
      );

      return reply.code(201).send(result);
    },
  );
};

export const casesRoutes: FastifyPluginAsync = casesRoutesPlugin;
