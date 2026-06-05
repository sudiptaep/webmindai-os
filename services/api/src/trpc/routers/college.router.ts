import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure, deptAdminProcedure } from "../trpc";
import { getCollegeModel } from "../../models/platform/college.model";
import { provisionCollege, assignDeptAdmin } from "../../services/provision.service";
import { getCollegeDb } from "../../db/college.db";
import { getDeptAdminModel } from "../../models/college/dept-admin.model";
import { getStudentModel } from "../../models/college/student.model";
import { getDepartmentModel } from "../../models/college/department.model";
import { getDocumentModel } from "../../models/college/document.model";
import type { CollegeStatus } from "@college-chatbot/shared";

export const collegeRouter = router({
  // ── CRUD ──────────────────────────────────────────────────────────────────

  create: superAdminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        type: z.enum(["engineering", "medical", "other"]),
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
        owner_email: z.string().email(),
        token_limit_per_month: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await provisionCollege(input);
      } catch (err: unknown) {
        const e = err as Error & { code?: string };
        if (e.code === "SLUG_TAKEN")
          throw new TRPCError({ code: "CONFLICT", message: "Slug already taken" });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
      }
    }),

  list: superAdminProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(100).default(20),
          status: z.enum(["active", "suspended", "deleted"]).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const { page = 1, limit = 20, status } = input ?? {};
      const College = getCollegeModel();
      const filter = status ? { status } : ({ status: { $ne: "deleted" as CollegeStatus } });
      const [colleges, total] = await Promise.all([
        College.find(filter)
          .sort({ created_at: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        College.countDocuments(filter),
      ]);
      return { colleges, total, page, limit, pages: Math.ceil(total / limit) };
    }),

  get: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const College = getCollegeModel();
      const college = await College.findById(input.id).lean();
      if (!college) throw new TRPCError({ code: "NOT_FOUND", message: "College not found" });
      return college;
    }),

  update: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        type: z.enum(["engineering", "medical", "other"]).optional(),
        token_limit_per_month: z.number().int().positive().optional(),
        status: z.enum(["active", "suspended"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      const College = getCollegeModel();
      const college = await College.findByIdAndUpdate(id, updates, { new: true }).lean();
      if (!college) throw new TRPCError({ code: "NOT_FOUND", message: "College not found" });
      return college;
    }),

  delete: superAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const College = getCollegeModel();
      const college = await College.findByIdAndUpdate(
        input.id,
        { status: "deleted" as CollegeStatus },
        { new: true },
      ).lean();
      if (!college) throw new TRPCError({ code: "NOT_FOUND", message: "College not found" });
      return { success: true };
    }),

  // ── Admin management ──────────────────────────────────────────────────────

  addAdmin: superAdminProcedure
    .input(
      z.object({
        college_id: z.string(),
        email: z.string().email(),
        dept_id: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const { college_id, email, dept_id } = input;
      try {
        await assignDeptAdmin(college_id, email, dept_id);
        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: (err as Error).message,
        });
      }
    }),

  removeAdmin: superAdminProcedure
    .input(z.object({ college_id: z.string(), admin_id: z.string() }))
    .mutation(async ({ input }) => {
      const { college_id, admin_id } = input;
      const conn = await getCollegeDb(college_id);
      const DeptAdmin = getDeptAdminModel(conn);
      const admin = await DeptAdmin.findById(admin_id).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await DeptAdmin.findByIdAndUpdate(admin_id, { status: "disabled" });
      return { success: true };
    }),

  listAdmins: superAdminProcedure
    .input(z.object({ college_id: z.string() }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const DeptAdmin = getDeptAdminModel(conn);
      return DeptAdmin.find({ college_id: input.college_id })
        .select("-password_hash")
        .lean();
    }),

  // ── Platform analytics ────────────────────────────────────────────────────

  analyticsOverview: superAdminProcedure.query(async () => {
    const College = getCollegeModel();
    const [active, suspended, total] = await Promise.all([
      College.countDocuments({ status: "active" }),
      College.countDocuments({ status: "suspended" }),
      College.countDocuments({ status: { $ne: "deleted" } }),
    ]);
    return { active, suspended, total };
  }),

  analyticsCollege: superAdminProcedure
    .input(z.object({ college_id: z.string() }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const [deptCount, studentCount, docCount] = await Promise.all([
        getDepartmentModel(conn).countDocuments({ college_id: input.college_id }),
        getStudentModel(conn).countDocuments({ college_id: input.college_id }),
        getDocumentModel(conn).countDocuments({ college_id: input.college_id }),
      ]);
      return { deptCount, studentCount, docCount };
    }),

  // Dept admin: get own college info (name, type, slug)
  getOwn: deptAdminProcedure.query(async ({ ctx }) => {
    if (!ctx.collegeId) throw new TRPCError({ code: "BAD_REQUEST", message: "No college in token" });
    const College = getCollegeModel();
    const college = await College.findById(ctx.collegeId).select("name type slug status").lean();
    if (!college) throw new TRPCError({ code: "NOT_FOUND", message: "College not found" });
    return college;
  }),
});

export type CollegeRouter = typeof collegeRouter;
