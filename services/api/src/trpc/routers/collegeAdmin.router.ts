import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, collegeAdminProcedure, superAdminProcedure } from "../trpc";
import { getCollegeAdminModel } from "../../models/college/college-admin.model";
import { getDeptAdminModel } from "../../models/college/dept-admin.model";
import { getDepartmentModel } from "../../models/college/department.model";
import { getDocumentModel } from "../../models/college/document.model";
import { getStudentModel } from "../../models/college/student.model";
import { getAdminActivityLogModel } from "../../models/college/admin-activity-log.model";
import { logAdminAction } from "../../services/activityLog.service";
import { sendDeptAdminInvite, sendDeptAdminPasswordReset } from "../../services/email.service";
import { getCollegeModel } from "../../models/platform/college.model";
import { getRedisConnection } from "../../services/queue.service";
import { isCollegeAdmin, isSuperAdmin } from "@college-chatbot/shared";

const INVITE_TTL_DAYS = Number(process.env.INVITE_TOKEN_TTL_DAYS ?? 7);
const RESET_TTL = 3600;

function inviteExpiresAt(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export const collegeAdminRouter = router({

  // ── Dashboard ─────────────────────────────────────────────────────────────

  getDashboard: collegeAdminProcedure
    .query(async ({ ctx }) => {
      const college_id = ctx.user.college_id;
      const conn = await ctx.getCollegeDb();

      const [depts, deptAdmins] = await Promise.all([
        getDepartmentModel(conn).find({ deleted: { $ne: true } }).lean(),
        getDeptAdminModel(conn).find().select("-password_hash -invite_token").lean(),
      ]);

      const students = await getStudentModel(conn).countDocuments({ status: "active" });
      const docCounts = await getDocumentModel(conn).aggregate([
        { $group: { _id: "$dept_id", count: { $sum: 1 } } },
      ]);
      const docMap = new Map(docCounts.map((d) => [d._id as string, d.count as number]));

      const adminMap = new Map(deptAdmins.map((a) => [a.dept_id, a]));

      const departmentsWithStats = depts.map((d) => ({
        ...d,
        document_count: docMap.get(String(d._id)) ?? 0,
        admin: adminMap.get(String(d._id)) ?? null,
      }));

      return {
        college_id,
        departments: departmentsWithStats,
        kpi: { total_departments: depts.length, total_students: students },
        dept_admins: deptAdmins,
      };
    }),

  // ── Analytics ─────────────────────────────────────────────────────────────

  getCrossDeptAnalytics: collegeAdminProcedure
    .input(z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }).optional())
    .query(async ({ ctx }) => {
      const conn = await ctx.getCollegeDb();
      const depts = await getDepartmentModel(conn).find({ deleted: { $ne: true } }).lean();

      const docCounts = await getDocumentModel(conn).aggregate([
        { $group: { _id: "$dept_id", count: { $sum: 1 } } },
      ]);
      const studentCounts = await getStudentModel(conn).aggregate([
        { $group: { _id: "$dept_id", count: { $sum: 1 } } },
      ]);

      const docMap = new Map(docCounts.map((d) => [d._id as string, d.count as number]));
      const stuMap = new Map(studentCounts.map((d) => [d._id as string, d.count as number]));

      return {
        departments: depts.map((d) => ({
          dept_id: String(d._id),
          dept_name: d.name,
          document_count: docMap.get(String(d._id)) ?? 0,
          student_count: stuMap.get(String(d._id)) ?? 0,
        })),
      };
    }),

  getFacultyActivity: collegeAdminProcedure
    .query(async ({ ctx }) => {
      const conn = await ctx.getCollegeDb();
      const deptAdmins = await getDeptAdminModel(conn)
        .find()
        .select("-password_hash -invite_token -password_reset_token")
        .lean();

      const depts = await getDepartmentModel(conn).find().lean();
      const deptMap = new Map(depts.map((d) => [String(d._id), d.name]));

      return deptAdmins.map((a) => ({
        ...a,
        dept_name: deptMap.get(a.dept_id) ?? "Unknown",
      }));
    }),

  getStudentOverview: collegeAdminProcedure
    .input(z.object({
      dept_id: z.string().optional(),
      status: z.enum(["active", "disabled", "pending_approval"]).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const { dept_id, status, page = 1, limit = 20 } = input ?? {};
      const filter: Record<string, unknown> = {};
      if (dept_id) filter.dept_id = dept_id;
      if (status) filter.status = status;

      const [students, total] = await Promise.all([
        getStudentModel(conn)
          .find(filter)
          .select("-password_hash")
          .sort({ created_at: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        getStudentModel(conn).countDocuments(filter),
      ]);

      return { students, total, page, limit };
    }),

  // ── Departments (read-only) ───────────────────────────────────────────────

  listDepartments: collegeAdminProcedure
    .query(async ({ ctx }) => {
      const conn = await ctx.getCollegeDb();
      return getDepartmentModel(conn).find({ deleted: { $ne: true } }).lean();
    }),

  getDepartment: collegeAdminProcedure
    .input(z.object({ dept_id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const dept = await getDepartmentModel(conn).findById(input.dept_id).lean();
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });
      return dept;
    }),

  getDeptDocuments: collegeAdminProcedure
    .input(z.object({
      dept_id: z.string(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const filter = { dept_id: input.dept_id };
      const [documents, total] = await Promise.all([
        getDocumentModel(conn)
          .find(filter)
          .select("-file_path")
          .sort({ created_at: -1 })
          .skip((input.page - 1) * input.limit)
          .limit(input.limit)
          .lean(),
        getDocumentModel(conn).countDocuments(filter),
      ]);
      return { documents, total, page: input.page, limit: input.limit };
    }),

  getDeptStudents: collegeAdminProcedure
    .input(z.object({
      dept_id: z.string(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const [students, total] = await Promise.all([
        getStudentModel(conn)
          .find({ dept_id: input.dept_id })
          .select("-password_hash")
          .sort({ created_at: -1 })
          .skip((input.page - 1) * input.limit)
          .limit(input.limit)
          .lean(),
        getStudentModel(conn).countDocuments({ dept_id: input.dept_id }),
      ]);
      return { students, total, page: input.page, limit: input.limit };
    }),

  // ── Dept Admin Management ─────────────────────────────────────────────────

  listDeptAdmins: collegeAdminProcedure
    .query(async ({ ctx }) => {
      const conn = await ctx.getCollegeDb();
      return getDeptAdminModel(conn)
        .find()
        .select("-password_hash -invite_token -password_reset_token")
        .sort({ created_at: -1 })
        .lean();
    }),

  createDeptAdmin: collegeAdminProcedure
    .input(z.object({
      dept_id: z.string().min(1),
      name: z.string().min(1),
      email: z.string().email(),
      faculty_title: z.enum(["Professor", "Associate Prof", "Assistant Prof", "Lab In-Charge", "Coordinator"]).optional(),
      phone: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (isCollegeAdmin(ctx.user) && !ctx.user.permissions.can_create_dept_admins) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to create dept admins" });
      }

      const conn = await ctx.getCollegeDb();
      const dept = await getDepartmentModel(conn).findById(input.dept_id).lean();
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });

      const DeptAdminModel = getDeptAdminModel(conn);
      const existing = await DeptAdminModel.findOne({ email: input.email.toLowerCase() }).lean();
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered in this college" });

      const token = randomUUID();
      const college_id = ctx.user.college_id;

      const admin = await DeptAdminModel.create({
        college_id, dept_id: input.dept_id,
        name: input.name, email: input.email.toLowerCase(),
        phone: input.phone, faculty_title: input.faculty_title,
        permissions: {
          can_upload_documents: true, can_delete_documents: true,
          can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
        },
        status: "invited",
        invite_token: token, invite_token_expires_at: inviteExpiresAt(),
        invited_by: ctx.user.sub, invited_by_role: "college_admin",
      });

      // Increment college dept_admin_count
      await getCollegeModel().updateOne({ _id: college_id }, { $inc: { dept_admin_count: 1 } }).catch(() => {});

      const college = await getCollegeModel().findById(college_id).lean();
      if (college) {
        sendDeptAdminInvite(input.email, token, college.slug, input.name, dept.name, college.name).catch(() => {});
      }

      await logAdminAction(conn, {
        college_id, actor_id: ctx.user.sub, actor_role: "college_admin",
        actor_name: ctx.user.admin_name, action: "create_dept_admin",
        target_type: "dept_admin", target_id: String(admin._id), target_name: input.name,
        dept_id: input.dept_id, dept_name: dept.name,
      });

      return { id: String(admin._id), message: "Dept admin created and invitation sent." };
    }),

  getDeptAdmin: collegeAdminProcedure
    .input(z.object({ admin_id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const admin = await getDeptAdminModel(conn)
        .findById(input.admin_id)
        .select("-password_hash -password_reset_token -invite_token")
        .lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      return admin;
    }),

  deactivateDeptAdmin: collegeAdminProcedure
    .input(z.object({ admin_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (isCollegeAdmin(ctx.user) && !ctx.user.permissions.can_deactivate_dept_admins) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to deactivate dept admins" });
      }
      const conn = await ctx.getCollegeDb();
      const admin = await getDeptAdminModel(conn).findOneAndUpdate(
        { _id: input.admin_id }, { $set: { status: "disabled" } }, { new: true }
      ).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await logAdminAction(conn, {
        college_id: ctx.user.college_id, actor_id: ctx.user.sub, actor_role: "college_admin",
        actor_name: ctx.user.admin_name, action: "deactivate_dept_admin",
        target_type: "dept_admin", target_id: input.admin_id, target_name: admin.name,
      });
      return { success: true };
    }),

  reactivateDeptAdmin: collegeAdminProcedure
    .input(z.object({ admin_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (isCollegeAdmin(ctx.user) && !ctx.user.permissions.can_deactivate_dept_admins) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to reactivate dept admins" });
      }
      const conn = await ctx.getCollegeDb();
      const admin = await getDeptAdminModel(conn).findOneAndUpdate(
        { _id: input.admin_id }, { $set: { status: "active" } }, { new: true }
      ).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await logAdminAction(conn, {
        college_id: ctx.user.college_id, actor_id: ctx.user.sub, actor_role: "college_admin",
        actor_name: ctx.user.admin_name, action: "reactivate_dept_admin",
        target_type: "dept_admin", target_id: input.admin_id, target_name: admin.name,
      });
      return { success: true };
    }),

  resendDeptAdminInvite: collegeAdminProcedure
    .input(z.object({ admin_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const DeptAdminModel = getDeptAdminModel(conn);
      const admin = await DeptAdminModel.findById(input.admin_id).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });

      const token = randomUUID();
      await DeptAdminModel.updateOne(
        { _id: input.admin_id },
        { $set: { invite_token: token, invite_token_expires_at: inviteExpiresAt() } },
      );

      const college = await getCollegeModel().findById(ctx.user.college_id).lean();
      if (college) {
        const dept = await getDepartmentModel(conn).findById(admin.dept_id).lean();
        sendDeptAdminInvite(admin.email, token, college.slug, admin.name, dept?.name ?? "", college.name).catch(() => {});
      }

      return { success: true };
    }),

  getDeptAdminActivityLog: collegeAdminProcedure
    .input(z.object({
      admin_id: z.string(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Log = getAdminActivityLogModel(conn);
      const filter = { actor_id: input.admin_id };
      const [logs, total] = await Promise.all([
        Log.find(filter).sort({ created_at: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(),
        Log.countDocuments(filter),
      ]);
      return { logs, total, page: input.page, limit: input.limit };
    }),

  // ── Student Management ────────────────────────────────────────────────────

  listStudents: collegeAdminProcedure
    .input(z.object({
      dept_id: z.string().optional(),
      status: z.enum(["active", "disabled", "pending_approval"]).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (isCollegeAdmin(ctx.user) && !ctx.user.permissions.can_view_student_list) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to view student list" });
      }
      const conn = await ctx.getCollegeDb();
      const { dept_id, status, page = 1, limit = 20 } = input ?? {};
      const filter: Record<string, unknown> = {};
      if (dept_id) filter.dept_id = dept_id;
      if (status) filter.status = status;

      const [students, total] = await Promise.all([
        getStudentModel(conn)
          .find(filter).select("-password_hash").sort({ created_at: -1 })
          .skip((page - 1) * limit).limit(limit).lean(),
        getStudentModel(conn).countDocuments(filter),
      ]);
      return { students, total, page, limit };
    }),

  disableStudent: collegeAdminProcedure
    .input(z.object({ student_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const student = await getStudentModel(conn).findOneAndUpdate(
        { _id: input.student_id }, { $set: { status: "disabled" } }, { new: true }
      ).lean();
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Student not found" });
      await logAdminAction(conn, {
        college_id: ctx.user.college_id, actor_id: ctx.user.sub, actor_role: "college_admin",
        actor_name: ctx.user.admin_name, action: "disable_student",
        target_type: "student", target_id: input.student_id, target_name: student.name,
      });
      return { success: true };
    }),

  resetStudentPassword: collegeAdminProcedure
    .input(z.object({ student_id: z.string(), new_password: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const student = await getStudentModel(conn).findById(input.student_id).lean();
      if (!student) throw new TRPCError({ code: "NOT_FOUND", message: "Student not found" });

      const passwordHash = await bcrypt.hash(input.new_password, 12);
      await getStudentModel(conn).updateOne({ _id: input.student_id }, { $set: { password_hash: passwordHash } });

      await logAdminAction(conn, {
        college_id: ctx.user.college_id, actor_id: ctx.user.sub, actor_role: "college_admin",
        actor_name: ctx.user.admin_name, action: "reset_student_password",
        target_type: "student", target_id: input.student_id, target_name: student.name,
      });
      return { success: true };
    }),

  // ── Profile ───────────────────────────────────────────────────────────────

  getProfile: collegeAdminProcedure
    .query(async ({ ctx }) => {
      const conn = await ctx.getCollegeDb();
      const admin = await getCollegeAdminModel(conn)
        .findById(ctx.user.sub)
        .select("-password_hash -invite_token -password_reset_token")
        .lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });
      return admin;
    }),

  updateProfile: collegeAdminProcedure
    .input(z.object({ name: z.string().min(1).optional(), phone: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      await getCollegeAdminModel(conn).updateOne({ _id: ctx.user.sub }, { $set: input });
      return { success: true };
    }),

  changePassword: collegeAdminProcedure
    .input(z.object({
      current_password: z.string().min(1),
      new_password: z.string().min(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const admin = await getCollegeAdminModel(conn).findById(ctx.user.sub).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });

      const ok = await bcrypt.compare(input.current_password, admin.password_hash);
      if (!ok) throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect" });

      const passwordHash = await bcrypt.hash(input.new_password, 12);
      await getCollegeAdminModel(conn).updateOne({ _id: ctx.user.sub }, { $set: { password_hash: passwordHash } });
      return { success: true };
    }),

  // ── Activity Log (own actions) ────────────────────────────────────────────

  getActivityLog: collegeAdminProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(10),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const { page = 1, limit = 10 } = input ?? {};
      const filter = { actor_id: ctx.user.sub };
      const [logs, total] = await Promise.all([
        getAdminActivityLogModel(conn).find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        getAdminActivityLogModel(conn).countDocuments(filter),
      ]);
      return { logs, total, page, limit };
    }),
});
