import { randomUUID } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure, deptAdminProcedure } from "../trpc";
import { getCollegeDb } from "../../db/college.db";
import { getDepartmentModel } from "../../models/college/department.model";
import { getStudentModel } from "../../models/college/student.model";
import { buildPineconeNamespace } from "@college-chatbot/shared";

export const departmentRouter = router({
  // Super admin: create dept in a college
  create: superAdminProcedure
    .input(z.object({
      college_id: z.string(),
      name: z.string().min(1),
      code: z.string().min(1),
      type: z.enum(["engineering", "medical", "other"]),
    }))
    .mutation(async ({ input }) => {
      const { college_id, name, type } = input;
      const code = input.code.toUpperCase();

      const conn = await getCollegeDb(college_id);
      const Department = getDepartmentModel(conn);

      const exists = await Department.findOne({ college_id, code }).lean();
      if (exists)
        throw new TRPCError({ code: "CONFLICT", message: "Department code already exists in this college" });

      const deptId = randomUUID();
      const dept = await Department.create({
        _id: deptId, college_id, name, code, type,
        is_generic: false, cannot_delete: false,
        pinecone_namespace: buildPineconeNamespace(college_id, deptId),
      });
      return dept.toObject();
    }),

  // Super admin: list all depts in a college
  list: superAdminProcedure
    .input(z.object({ college_id: z.string() }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const Department = getDepartmentModel(conn);
      return Department.find({ college_id: input.college_id, deleted: { $ne: true } }).sort({ is_generic: -1, name: 1 }).lean();
    }),

  // Dept admin: list own dept (single)
  listOwn: deptAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.collegeId) throw new TRPCError({ code: "BAD_REQUEST", message: "No college in token" });
    const conn = await ctx.getCollegeDb();
    const Department = getDepartmentModel(conn);
    const dept = await Department.findById(ctx.user.dept_id).lean();
    return dept ? [dept] : [];
  }),

  // Super admin: soft-delete dept
  delete: superAdminProcedure
    .input(z.object({ college_id: z.string(), dept_id: z.string() }))
    .mutation(async ({ input }) => {
      const { college_id, dept_id } = input;
      const conn = await getCollegeDb(college_id);
      const Department = getDepartmentModel(conn);

      const dept = await Department.findById(dept_id).lean();
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });
      if (dept.is_generic)
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete the Generic Department" });

      await Department.findByIdAndUpdate(dept_id, { $set: { deleted: true } });

      const genericDept = await Department.findOne({ college_id, is_generic: true }).lean();
      if (genericDept) {
        const Student = getStudentModel(conn);
        await Student.updateMany(
          { dept_id, college_id },
          { effective_dept_id: String(genericDept._id), using_generic_fallback: true },
        );
      }

      return { success: true };
    }),

  // Get single dept (dept admin can only see their own)
  get: deptAdminProcedure
    .input(z.object({ dept_id: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.collegeId) throw new TRPCError({ code: "BAD_REQUEST" });

      if (ctx.user.dept_id !== input.dept_id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const conn = await ctx.getCollegeDb();
      const Department = getDepartmentModel(conn);
      const dept = await Department.findById(input.dept_id).lean();
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });
      return dept;
    }),
});

export type DepartmentRouter = typeof departmentRouter;
