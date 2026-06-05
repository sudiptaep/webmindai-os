import { randomUUID } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, deptAdminProcedure, superAdminProcedure, protectedProcedure } from "../trpc";
import { getCollegeDb } from "../../db/college.db";
import { getSubjectModel } from "../../models/college/subject.model";
import { getDocumentModel } from "../../models/college/document.model";
import { isDeptAdmin, isCollegeAdmin, isSuperAdmin } from "@college-chatbot/shared";

export const subjectRouter = router({
  create: deptAdminProcedure
    .input(
      z.object({
        dept_id: z.string(),
        name: z.string().min(1),
        code: z.string().min(1),
        semester: z.number().int().min(1).max(10),
        year: z.number().int().min(1).max(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const collegeId = ctx.user.college_id;
      const code = input.code.toUpperCase();

      if (ctx.user.dept_id !== input.dept_id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
      }

      const conn = await getCollegeDb(collegeId);
      const Subject = getSubjectModel(conn);

      const exists = await Subject.findOne({ dept_id: input.dept_id, code }).lean();
      if (exists) throw new TRPCError({ code: "CONFLICT", message: "Subject code already exists in this dept" });

      const subject = await Subject.create({
        _id: randomUUID(),
        dept_id: input.dept_id,
        college_id: collegeId,
        name: input.name,
        code,
        semester: input.semester,
        year: input.year,
      });

      return subject.toObject();
    }),

  list: protectedProcedure
    .input(z.object({ college_id: z.string(), dept_id: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!isSuperAdmin(ctx.user) && !isCollegeAdmin(ctx.user) && !isDeptAdmin(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" });
      }

      if (isDeptAdmin(ctx.user)) {
        if (ctx.user.college_id !== input.college_id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "College mismatch" });
        }
        if (ctx.user.dept_id !== input.dept_id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
        }
      }

      if (isCollegeAdmin(ctx.user) && ctx.user.college_id !== input.college_id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "College mismatch" });
      }

      const conn = await getCollegeDb(input.college_id);
      const Subject = getSubjectModel(conn);
      return Subject.find({ dept_id: input.dept_id }).sort({ year: 1, semester: 1 }).lean();
    }),

  update: deptAdminProcedure
    .input(
      z.object({
        subject_id: z.string(),
        dept_id: z.string(),
        name: z.string().min(1).optional(),
        semester: z.number().int().min(1).max(10).optional(),
        year: z.number().int().min(1).max(6).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const collegeId = ctx.user.college_id;

      if (ctx.user.dept_id !== input.dept_id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
      }

      const conn = await getCollegeDb(collegeId);
      const Subject = getSubjectModel(conn);

      const subject = await Subject.findById(input.subject_id).lean();
      if (!subject) throw new TRPCError({ code: "NOT_FOUND", message: "Subject not found" });
      if (subject.dept_id !== input.dept_id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Subject does not belong to this dept" });
      }

      const updates: Record<string, unknown> = {};
      if (input.name) updates.name = input.name;
      if (input.semester) updates.semester = input.semester;
      if (input.year) updates.year = input.year;

      return Subject.findByIdAndUpdate(input.subject_id, { $set: updates }, { new: true, lean: true });
    }),

  delete: deptAdminProcedure
    .input(z.object({ subject_id: z.string(), dept_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const collegeId = ctx.user.college_id;

      if (ctx.user.dept_id !== input.dept_id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
      }

      const conn = await getCollegeDb(collegeId);
      const Subject = getSubjectModel(conn);
      const Document = getDocumentModel(conn);

      const subject = await Subject.findById(input.subject_id).lean();
      if (!subject) throw new TRPCError({ code: "NOT_FOUND", message: "Subject not found" });
      if (subject.dept_id !== input.dept_id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Subject does not belong to this dept" });
      }

      await Document.updateMany({ subject_id: input.subject_id }, { $unset: { subject_id: "" } });
      await Subject.findByIdAndDelete(input.subject_id);

      return { ok: true };
    }),

  listAll: superAdminProcedure
    .input(z.object({ college_id: z.string() }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const Subject = getSubjectModel(conn);
      return Subject.find({ college_id: input.college_id }).sort({ dept_id: 1, year: 1, semester: 1 }).lean();
    }),
});
