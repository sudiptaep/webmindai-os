import bcrypt from "bcrypt";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, studentProcedure, deptAdminProcedure, superAdminProcedure } from "../trpc";
import { getCollegeDb } from "../../db/college.db";
import { getStudentModel } from "../../models/college/student.model";
import { getSessionModel } from "../../models/college/session.model";
import { getQueryLogModel } from "../../models/college/query-log.model";
import { getDepartmentModel } from "../../models/college/department.model";
import { GENERIC_DEPT_CODE } from "@college-chatbot/shared";

export const studentRouter = router({
  // Student's own profile
  profile: studentProcedure.query(async ({ ctx }) => {
    const conn = await getCollegeDb(ctx.user.college_id);
    const Student = getStudentModel(conn);

    const student = await Student.findById(ctx.user.sub, {
      password_hash: 0,
    }).lean();
    if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Student not found" });

    return student;
  }),

  // List student's own sessions (paginated, most recent first)
  sessions: studentProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conn = await getCollegeDb(ctx.user.college_id);
      const Session = getSessionModel(conn);

      const skip = (input.page - 1) * input.limit;
      const [sessions, total] = await Promise.all([
        Session.find({ student_id: ctx.user.sub }, { messages: 0 })
          .sort({ last_active: -1 })
          .skip(skip)
          .limit(input.limit)
          .lean(),
        Session.countDocuments({ student_id: ctx.user.sub }),
      ]);

      return { sessions, total, page: input.page, limit: input.limit };
    }),

  // Single session with full message history
  session: studentProcedure
    .input(z.object({ session_id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conn = await getCollegeDb(ctx.user.college_id);
      const Session = getSessionModel(conn);

      const session = await Session.findOne({
        _id: input.session_id,
        student_id: ctx.user.sub,
      }).lean();
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });

      return session;
    }),

  // Delete a session (student can clean up history)
  deleteSession: studentProcedure
    .input(z.object({ session_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getCollegeDb(ctx.user.college_id);
      const Session = getSessionModel(conn);

      const result = await Session.deleteOne({
        _id: input.session_id,
        student_id: ctx.user.sub,
      });
      if (result.deletedCount === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      }

      return { ok: true };
    }),

  // Opt-in to use generic dept if student's dept has no content yet
  setDeptFallback: studentProcedure
    .input(z.object({ use_fallback: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getCollegeDb(ctx.user.college_id);
      const Student = getStudentModel(conn);
      const Department = getDepartmentModel(conn);

      if (input.use_fallback) {
        // Find generic dept
        const genericDept = await Department.findOne({
          college_id: ctx.user.college_id,
          is_generic: true,
        }).lean();
        if (!genericDept) throw new TRPCError({ code: "NOT_FOUND", message: "Generic dept not found" });

        await Student.findByIdAndUpdate(ctx.user.sub, {
          $set: {
            using_generic_fallback: true,
            effective_dept_id: genericDept._id,
          },
        });
      } else {
        // Revert to own dept
        await Student.findByIdAndUpdate(ctx.user.sub, {
          $set: {
            using_generic_fallback: false,
            effective_dept_id: ctx.user.dept_id,
          },
        });
      }

      return { ok: true };
    }),

  // Student: update own profile (name and/or password)
  updateProfile: studentProcedure
    .input(
      z.object({
        name: z.string().min(1).optional(),
        current_password: z.string().optional(),
        new_password: z.string().min(8).optional(),
      }).refine(
        (d) => !d.new_password || !!d.current_password,
        { message: "current_password required to change password" }
      )
    )
    .mutation(async ({ ctx, input }) => {
      const conn = await getCollegeDb(ctx.user.college_id);
      const Student = getStudentModel(conn);

      const student = await Student.findById(ctx.user.sub).lean();
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Student not found" });

      const update: Record<string, unknown> = {};
      if (input.name) update.name = input.name;

      if (input.new_password) {
        const valid = await bcrypt.compare(input.current_password!, student.password_hash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect" });
        update.password_hash = await bcrypt.hash(input.new_password, 12);
      }

      if (Object.keys(update).length === 0) return { ok: true };

      await Student.updateOne({ _id: ctx.user.sub }, { $set: update });
      return { ok: true };
    }),

  // Dept admin: list students in their dept(s)
  list: deptAdminProcedure
    .input(
      z.object({
        dept_id: z.string().optional(),
        status: z.enum(["active", "disabled", "pending_approval"]).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(1000).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conn = await getCollegeDb(ctx.user.college_id);
      const Student = getStudentModel(conn);

      const filter: Record<string, unknown> = {};
      if (input.status) filter.status = input.status;
      if (input.dept_id) {
        if (!ctx.user.is_college_owner && !ctx.user.dept_ids.includes(input.dept_id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
        }
        filter.dept_id = input.dept_id;
      } else if (!ctx.user.is_college_owner) {
        filter.dept_id = { $in: ctx.user.dept_ids };
      }

      const skip = (input.page - 1) * input.limit;
      const [students, total] = await Promise.all([
        Student.find(filter as never, { password_hash: 0 })
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(input.limit)
          .lean(),
        Student.countDocuments(filter as never),
      ]);

      return { students, total, page: input.page, limit: input.limit };
    }),

  // Dept admin: disable/enable a student account
  setStatus: deptAdminProcedure
    .input(
      z.object({
        student_id: z.string(),
        status: z.enum(["active", "disabled", "pending_approval"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conn = await getCollegeDb(ctx.user.college_id);
      const Student = getStudentModel(conn);

      const student = await Student.findById(input.student_id).lean();
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Student not found" });

      if (!ctx.user.is_college_owner && !ctx.user.dept_ids.includes(student.dept_id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
      }

      await Student.findByIdAndUpdate(input.student_id, { $set: { status: input.status } });
      return { ok: true };
    }),

  // Dept admin: permanently delete a student and their data
  deleteStudent: deptAdminProcedure
    .input(z.object({ student_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await getCollegeDb(ctx.user.college_id);
      const Student = getStudentModel(conn);

      const student = await Student.findById(input.student_id).lean();
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Student not found" });

      if (!ctx.user.is_college_owner && !ctx.user.dept_ids.includes(student.dept_id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
      }

      const Session  = getSessionModel(conn);
      const QueryLog = getQueryLogModel(conn);

      await Promise.all([
        Student.findByIdAndDelete(input.student_id),
        Session.deleteMany({ student_id: input.student_id }),
        QueryLog.deleteMany({ student_id: input.student_id }),
      ]);

      return { ok: true };
    }),

  // Super admin: student count per college
  countByCollege: superAdminProcedure
    .input(z.object({ college_id: z.string() }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const Student = getStudentModel(conn);
      return {
        total: await Student.countDocuments({}),
        active: await Student.countDocuments({ status: "active" }),
        using_fallback: await Student.countDocuments({ using_generic_fallback: true }),
      };
    }),
});
