import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { Connection } from "mongoose";
import { z } from "zod";
import { verifyJWT } from "../middleware/verifyJWT";
import { resolveCollege } from "../middleware/resolveCollege";
import { requireRole } from "../middleware/checkRole";
import { getCollegeDb } from "../db/college.db";
import { getStudentModel } from "../models/college/student.model";
import { getSubjectModel } from "../models/college/subject.model";
import { getDocumentModel } from "../models/college/document.model";
import type { StudentJWTPayload } from "@college-chatbot/shared";

function getStudent(req: FastifyRequest): StudentJWTPayload {
  return req.user as StudentJWTPayload;
}

const UpdateYearSchema = z.object({
  current_year:     z.number().int().min(1).max(4),
  current_semester: z.number().int().min(1).max(8),
});

// ─── Core view builder ────────────────────────────────────────────────────────

async function buildMyYearView(studentId: string, collegeId: string, conn: Connection) {
  const Student  = getStudentModel(conn);
  const Subject  = getSubjectModel(conn);
  const Document = getDocumentModel(conn);

  const student = await Student.findById(studentId).lean();
  if (!student) throw new Error("Student not found");

  const currentYear     = student.current_year ?? 1;
  const currentSemester = student.current_semester ?? 1;

  // Subjects matching year + semester, or year-only fallback (semester not yet tagged)
  const subjects = await Subject.find({
    $or: [
      { year: currentYear, semester: currentSemester },
      { year: currentYear, semester: { $exists: false } },
    ],
  }).lean();

  if (subjects.length === 0) {
    return {
      student_year:     currentYear,
      student_semester: currentSemester,
      subjects:         [],
      total_subjects:   0,
      total_docs:       0,
      srs_cards_due_today: student.srs_cards_due_today ?? 0,
      study_streak:        student.srs_streak_days     ?? 0,
    };
  }

  // Bulk-load all visible completed docs in one query, then group by subject_id in memory
  const subjectIds = subjects.map(s => String(s._id));
  const docs = await Document.find({
    subject_id:            { $in: subjectIds },
    ingestion_status:      "completed",
    is_visible_to_students: { $ne: false },
  })
    .select("_id original_filename file_type subject_id has_chapter_map chapter_count page_count")
    .lean();

  const docsBySubject = new Map<string, typeof docs>();
  for (const d of docs) {
    const sid = String(d.subject_id ?? "");
    if (!docsBySubject.has(sid)) docsBySubject.set(sid, []);
    docsBySubject.get(sid)!.push(d);
  }

  const enrichedSubjects = subjects.map(s => {
    const subjectDocs = docsBySubject.get(String(s._id)) ?? [];
    return {
      subject_id:   String(s._id),
      name:         s.name,
      code:         s.code,
      year:         s.year,
      semester:     s.semester,
      dept_id:      s.dept_id,
      disease_tags: s.disease_tags ?? [],
      doc_count:    subjectDocs.length,
      docs:         subjectDocs.map(d => ({
        doc_id:          String(d._id),
        filename:        d.original_filename,
        file_type:       d.file_type,
        has_chapter_map: d.has_chapter_map ?? false,
        chapter_count:   d.chapter_count  ?? 0,
        page_count:      d.page_count     ?? 0,
      })),
    };
  });

  return {
    student_year:     currentYear,
    student_semester: currentSemester,
    subjects:         enrichedSubjects,
    total_subjects:   enrichedSubjects.length,
    total_docs:       enrichedSubjects.reduce((sum, s) => sum + s.doc_count, 0),
    srs_cards_due_today: student.srs_cards_due_today ?? 0,
    study_streak:        student.srs_streak_days     ?? 0,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const yearNavRoutesPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const PRE = [verifyJWT, resolveCollege, requireRole("student")];

  // ── My Year view (student dashboard data) ─────────────────────────────────
  fastify.get(
    "/college/:collegeId/student/my-year",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const result = await buildMyYearView(student.sub, collegeId, conn);
      return reply.send(result);
    },
  );

  // ── Update student year + semester ────────────────────────────────────────
  fastify.patch(
    "/college/:collegeId/student/update-year",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = req.params as { collegeId: string };
      const student = getStudent(req);
      const conn = await getCollegeDb(collegeId);

      const { current_year, current_semester } = UpdateYearSchema.parse(req.body ?? {});

      const Student = getStudentModel(conn);
      const result = await Student.updateOne(
        { _id: student.sub },
        { $set: { current_year, current_semester } },
      );

      if (result.matchedCount === 0) {
        return reply.code(404).send({ error: "Student not found" });
      }

      return reply.send({ ok: true, current_year, current_semester });
    },
  );

  // ── Browse any year's subjects (for switching year view) ──────────────────
  fastify.get(
    "/college/:collegeId/student/year/:year/subjects",
    { preHandler: PRE },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { collegeId, year } = req.params as { collegeId: string; year: string };
      const { semester } = req.query as { semester?: string };
      const conn = await getCollegeDb(collegeId);

      const Subject  = getSubjectModel(conn);
      const Document = getDocumentModel(conn);

      const yearNum = Number(year);
      if (isNaN(yearNum) || yearNum < 1 || yearNum > 4) {
        return reply.code(400).send({ error: "Year must be 1–4" });
      }

      const filter: Record<string, unknown> = { year: yearNum };
      if (semester) {
        const semNum = Number(semester);
        if (!isNaN(semNum)) filter.semester = semNum;
      }

      const subjects = await Subject.find(filter).lean();

      const subjectIds = subjects.map(s => String(s._id));
      const docs = await Document.find({
        subject_id:            { $in: subjectIds },
        ingestion_status:      "completed",
        is_visible_to_students: { $ne: false },
      })
        .select("_id original_filename file_type subject_id has_chapter_map")
        .lean();

      const docsBySubject = new Map<string, typeof docs>();
      for (const d of docs) {
        const sid = String(d.subject_id ?? "");
        if (!docsBySubject.has(sid)) docsBySubject.set(sid, []);
        docsBySubject.get(sid)!.push(d);
      }

      return reply.send({
        year:     yearNum,
        semester: semester ? Number(semester) : null,
        subjects: subjects.map(s => ({
          subject_id: String(s._id),
          name:       s.name,
          code:       s.code,
          semester:   s.semester,
          docs:       (docsBySubject.get(String(s._id)) ?? []).map(d => ({
            doc_id:          String(d._id),
            filename:        d.original_filename,
            file_type:       d.file_type,
            has_chapter_map: d.has_chapter_map ?? false,
          })),
        })),
      });
    },
  );
};

export const yearNavRoutes: FastifyPluginAsync = yearNavRoutesPlugin;
