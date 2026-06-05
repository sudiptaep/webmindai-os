import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure } from "../trpc";
import { getCollegeModel } from "../../models/platform/college.model";
import { getCollegeDb } from "../../db/college.db";
import { getCollegeAdminModel } from "../../models/college/college-admin.model";
import { getDeptAdminModel } from "../../models/college/dept-admin.model";
import { getAdminActivityLogModel } from "../../models/college/admin-activity-log.model";
import { getDepartmentModel } from "../../models/college/department.model";
import { logAdminAction } from "../../services/activityLog.service";
import {
  sendCollegeAdminInvite,
  sendDeptAdminInvite,
  sendCollegeAdminPasswordReset,
  sendDeptAdminPasswordReset,
} from "../../services/email.service";
import type { AdminStatus } from "@college-chatbot/shared";
import { getRedisConnection } from "../../services/queue.service";

const INVITE_TTL_DAYS = Number(process.env.INVITE_TOKEN_TTL_DAYS ?? 7);
const IMPERSONATION_EXPIRY = (process.env.IMPERSONATION_JWT_EXPIRY ?? "2h") as jwt.SignOptions["expiresIn"];
const RESET_TTL = 3600;

function inviteExpiresAt(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ─── college admin permissions schema ────────────────────────────────────────

const CollegeAdminPermissionsSchema = z.object({
  can_create_dept_admins: z.boolean().default(true),
  can_deactivate_dept_admins: z.boolean().default(true),
  can_view_student_list: z.boolean().default(true),
  can_export_reports: z.boolean().default(true),
  can_view_cost_usage: z.boolean().default(false),
});

const DeptAdminPermissionsSchema = z.object({
  can_upload_documents: z.boolean().default(true),
  can_delete_documents: z.boolean().default(true),
  can_manage_subjects: z.boolean().default(true),
  can_view_student_list: z.boolean().default(true),
  can_reset_student_passwords: z.boolean().default(false),
});

// ─── router ──────────────────────────────────────────────────────────────────

export const superAdminUsersRouter = router({

  // ── College Admins ─────────────────────────────────────────────────────────

  listCollegeAdmins: superAdminProcedure
    .input(z.object({
      college_id: z.string().optional(),
      status: z.enum(["active", "invited", "disabled"]).optional(),
      q: z.string().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const { college_id, status, q, page, limit } = input;
      const College = getCollegeModel();
      const colleges = college_id
        ? await College.find({ _id: college_id }).lean()
        : await College.find({ status: { $ne: "deleted" } }).lean();

      const results: unknown[] = [];
      for (const college of colleges) {
        const conn = await getCollegeDb(String(college._id));
        const CollegeAdmin = getCollegeAdminModel(conn);
        const filter: Record<string, unknown> = {};
        if (status) filter.status = status;
        if (q) filter.$or = [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }];
        const admins = await CollegeAdmin.find(filter)
          .select("-password_hash -password_reset_token -invite_token")
          .sort({ created_at: -1 })
          .lean();
        admins.forEach((a) => results.push({ ...a, college_name: college.name, college_slug: college.slug }));
      }

      const total = results.length;
      const paginated = results.slice((page - 1) * limit, page * limit);
      return { admins: paginated, total, page, limit };
    }),

  createCollegeAdmin: superAdminProcedure
    .input(z.object({
      college_id: z.string().min(1),
      name: z.string().min(1),
      email: z.string().email(),
      admin_title: z.enum(["Principal", "HOD", "Dean", "Registrar", "Academic Director", "Custom"]),
      custom_title: z.string().optional(),
      phone: z.string().optional(),
      permissions: CollegeAdminPermissionsSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const College = getCollegeModel();
      const college = await College.findById(input.college_id).lean();
      if (!college) throw new TRPCError({ code: "NOT_FOUND", message: "College not found" });

      const conn = await getCollegeDb(input.college_id);
      const CollegeAdmin = getCollegeAdminModel(conn);

      const existing = await CollegeAdmin.findOne({ email: input.email.toLowerCase() }).lean();
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered in this college" });

      const token = randomUUID();
      const permissions = input.permissions ?? {
        can_create_dept_admins: true, can_deactivate_dept_admins: true,
        can_view_student_list: true, can_export_reports: true, can_view_cost_usage: false,
      };

      const admin = await CollegeAdmin.create({
        college_id: input.college_id,
        name: input.name,
        email: input.email.toLowerCase(),
        phone: input.phone,
        admin_title: input.admin_title,
        custom_title: input.custom_title,
        permissions,
        status: "invited",
        invite_token: token,
        invite_token_expires_at: inviteExpiresAt(),
        invited_by: ctx.user.sub,
      });

      // Update college college_admin_count and primary_contact_email
      await College.updateOne(
        { _id: input.college_id },
        {
          $inc: { college_admin_count: 1 },
          $setOnInsert: { primary_contact_email: input.email.toLowerCase() },
        },
      ).catch(() => {});

      // Non-blocking invite email
      sendCollegeAdminInvite(
        input.email, token, college.slug, input.name, input.admin_title, college.name,
      ).catch(() => {});

      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "create_college_admin",
        target_type: "college_admin", target_id: String(admin._id), target_name: input.name,
      });

      return { id: String(admin._id), message: "College admin created and invitation sent." };
    }),

  getCollegeAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getCollegeAdminModel(conn)
        .findById(input.admin_id)
        .select("-password_hash -password_reset_token -invite_token")
        .lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      return admin;
    }),

  updateCollegeAdmin: superAdminProcedure
    .input(z.object({
      admin_id: z.string(), college_id: z.string(),
      name: z.string().optional(), admin_title: z.enum(["Principal", "HOD", "Dean", "Registrar", "Academic Director", "Custom"]).optional(),
      custom_title: z.string().optional(), phone: z.string().optional(),
      permissions: CollegeAdminPermissionsSchema.partial().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getCollegeDb(input.college_id);
      const CollegeAdmin = getCollegeAdminModel(conn);
      const update: Record<string, unknown> = {};
      if (input.name) update.name = input.name;
      if (input.admin_title) update.admin_title = input.admin_title;
      if (input.custom_title !== undefined) update.custom_title = input.custom_title;
      if (input.phone !== undefined) update.phone = input.phone;
      if (input.permissions) {
        Object.entries(input.permissions).forEach(([k, v]) => {
          update[`permissions.${k}`] = v;
        });
      }
      await CollegeAdmin.updateOne({ _id: input.admin_id }, { $set: update });

      if (input.permissions) {
        await logAdminAction(conn, {
          college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
          actor_name: "Super Admin", action: "update_college_admin_permissions",
          target_type: "college_admin", target_id: input.admin_id, target_name: input.name ?? "",
          metadata: { permissions: input.permissions },
        });
      }

      return { success: true };
    }),

  deactivateCollegeAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getCollegeAdminModel(conn).findOneAndUpdate(
        { _id: input.admin_id }, { $set: { status: "disabled" } }, { new: true }
      ).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "deactivate_college_admin",
        target_type: "college_admin", target_id: input.admin_id, target_name: admin.name,
      });
      return { success: true };
    }),

  reactivateCollegeAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getCollegeAdminModel(conn).findOneAndUpdate(
        { _id: input.admin_id }, { $set: { status: "active" } }, { new: true }
      ).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "reactivate_college_admin",
        target_type: "college_admin", target_id: input.admin_id, target_name: admin.name,
      });
      return { success: true };
    }),

  resetCollegeAdminPassword: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getCollegeAdminModel(conn).findById(input.admin_id).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });

      const college = await getCollegeModel().findById(input.college_id).lean();
      const token = randomUUID();
      const redis = getRedisConnection();
      await redis.setex(
        `reset:college_admin:${token}`, RESET_TTL,
        JSON.stringify({ id: input.admin_id, college_id: input.college_id }),
      );
      if (college) {
        sendCollegeAdminPasswordReset(admin.email, token, college.slug).catch(() => {});
      }

      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "reset_admin_password",
        target_type: "college_admin", target_id: input.admin_id, target_name: admin.name,
      });

      return { success: true };
    }),

  resendCollegeAdminInvite: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const CollegeAdmin = getCollegeAdminModel(conn);
      const admin = await CollegeAdmin.findById(input.admin_id).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });

      const token = randomUUID();
      await CollegeAdmin.updateOne(
        { _id: input.admin_id },
        { $set: { invite_token: token, invite_token_expires_at: inviteExpiresAt() } },
      );

      const college = await getCollegeModel().findById(input.college_id).lean();
      if (college) {
        sendCollegeAdminInvite(admin.email, token, college.slug, admin.name, admin.admin_title, college.name).catch(() => {});
      }

      return { success: true };
    }),

  getCollegeAdminActivityLog: superAdminProcedure
    .input(z.object({
      admin_id: z.string(), college_id: z.string(),
      page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const Log = getAdminActivityLogModel(conn);
      const filter = { actor_id: input.admin_id };
      const [logs, total] = await Promise.all([
        Log.find(filter).sort({ created_at: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(),
        Log.countDocuments(filter),
      ]);
      return { logs, total, page: input.page, limit: input.limit };
    }),

  impersonateCollegeAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (process.env.IMPERSONATION_ENABLED !== "true") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Impersonation is disabled" });
      }
      const conn = await getCollegeDb(input.college_id);
      const admin = await getCollegeAdminModel(conn).findById(input.admin_id).lean();
      if (!admin || admin.status !== "active") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found or inactive" });
      }
      const college = await getCollegeModel().findById(input.college_id).lean();
      if (!college) throw new TRPCError({ code: "NOT_FOUND", message: "College not found" });

      const secret = process.env.COLLEGE_ADMIN_JWT_SECRET ?? process.env.JWT_SECRET!;
      const impersonationToken = jwt.sign(
        {
          sub: String(admin._id), role: "college_admin",
          college_id: input.college_id, college_slug: college.slug, college_name: college.name,
          admin_name: admin.name, admin_title: admin.admin_title, permissions: admin.permissions,
          _impersonated_by: ctx.user.sub,
        },
        secret,
        { expiresIn: IMPERSONATION_EXPIRY },
      );

      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "impersonate_admin",
        target_type: "college_admin", target_id: input.admin_id, target_name: admin.name,
      });

      return { token: impersonationToken };
    }),

  deleteCollegeAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getCollegeAdminModel(conn).findByIdAndDelete(input.admin_id).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await getCollegeModel().updateOne({ _id: input.college_id }, { $inc: { college_admin_count: -1 } }).catch(() => {});
      return { success: true };
    }),

  // ── Dept Admins ────────────────────────────────────────────────────────────

  listDeptAdmins: superAdminProcedure
    .input(z.object({
      college_id: z.string().optional(), dept_id: z.string().optional(),
      status: z.enum(["active", "invited", "disabled"]).optional(),
      q: z.string().optional(),
      page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const { college_id, dept_id, status, q, page, limit } = input;
      const College = getCollegeModel();
      const colleges = college_id
        ? await College.find({ _id: college_id }).lean()
        : await College.find({ status: { $ne: "deleted" } }).lean();

      const results: unknown[] = [];
      for (const college of colleges) {
        const conn = await getCollegeDb(String(college._id));
        const DeptAdmin = getDeptAdminModel(conn);
        const filter: Record<string, unknown> = {};
        if (dept_id) filter.dept_id = dept_id;
        if (status) filter.status = status;
        if (q) filter.$or = [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }];
        const admins = await DeptAdmin.find(filter)
          .select("-password_hash -password_reset_token -invite_token")
          .sort({ created_at: -1 }).lean();

        const depts = await getDepartmentModel(conn).find().lean();
        const deptMap = new Map(depts.map((d) => [String(d._id), d.name]));
        admins.forEach((a) => results.push({
          ...a, college_name: college.name, college_slug: college.slug,
          dept_name: deptMap.get(a.dept_id) ?? "Unknown",
        }));
      }

      const total = results.length;
      const paginated = results.slice((page - 1) * limit, page * limit);
      return { admins: paginated, total, page, limit };
    }),

  createDeptAdmin: superAdminProcedure
    .input(z.object({
      college_id: z.string().min(1), dept_id: z.string().min(1),
      name: z.string().min(1), email: z.string().email(),
      faculty_title: z.enum(["Professor", "Associate Prof", "Assistant Prof", "Lab In-Charge", "Coordinator"]).optional(),
      phone: z.string().optional(),
      permissions: DeptAdminPermissionsSchema.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const College = getCollegeModel();
      const college = await College.findById(input.college_id).lean();
      if (!college) throw new TRPCError({ code: "NOT_FOUND", message: "College not found" });

      const conn = await getCollegeDb(input.college_id);
      const dept = await getDepartmentModel(conn).findById(input.dept_id).lean();
      if (!dept) throw new TRPCError({ code: "NOT_FOUND", message: "Department not found" });

      const DeptAdminModel = getDeptAdminModel(conn);
      const existing = await DeptAdminModel.findOne({ email: input.email.toLowerCase() }).lean();
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered in this college" });

      const token = randomUUID();
      const permissions = input.permissions ?? {
        can_upload_documents: true, can_delete_documents: true,
        can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
      };

      const admin = await DeptAdminModel.create({
        college_id: input.college_id, dept_id: input.dept_id,
        name: input.name, email: input.email.toLowerCase(),
        phone: input.phone, faculty_title: input.faculty_title,
        permissions, status: "invited",
        invite_token: token, invite_token_expires_at: inviteExpiresAt(),
        invited_by: ctx.user.sub, invited_by_role: "super_admin",
      });

      await College.updateOne({ _id: input.college_id }, { $inc: { dept_admin_count: 1 } }).catch(() => {});

      sendDeptAdminInvite(
        input.email, token, college.slug, input.name, dept.name, college.name,
      ).catch(() => {});

      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "create_dept_admin",
        target_type: "dept_admin", target_id: String(admin._id), target_name: input.name,
        dept_id: input.dept_id, dept_name: dept.name,
      });

      return { id: String(admin._id), message: "Dept admin created and invitation sent." };
    }),

  getDeptAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getDeptAdminModel(conn)
        .findById(input.admin_id)
        .select("-password_hash -password_reset_token -invite_token")
        .lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      return admin;
    }),

  updateDeptAdmin: superAdminProcedure
    .input(z.object({
      admin_id: z.string(), college_id: z.string(),
      name: z.string().optional(),
      faculty_title: z.enum(["Professor", "Associate Prof", "Assistant Prof", "Lab In-Charge", "Coordinator"]).optional(),
      phone: z.string().optional(),
      permissions: DeptAdminPermissionsSchema.partial().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getCollegeDb(input.college_id);
      const update: Record<string, unknown> = {};
      if (input.name) update.name = input.name;
      if (input.faculty_title) update.faculty_title = input.faculty_title;
      if (input.phone !== undefined) update.phone = input.phone;
      if (input.permissions) {
        Object.entries(input.permissions).forEach(([k, v]) => { update[`permissions.${k}`] = v; });
      }
      await getDeptAdminModel(conn).updateOne({ _id: input.admin_id }, { $set: update });

      if (input.permissions) {
        await logAdminAction(conn, {
          college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
          actor_name: "Super Admin", action: "update_dept_admin_permissions",
          target_type: "dept_admin", target_id: input.admin_id, target_name: input.name ?? "",
          metadata: { permissions: input.permissions },
        });
      }

      return { success: true };
    }),

  deactivateDeptAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getDeptAdminModel(conn).findOneAndUpdate(
        { _id: input.admin_id }, { $set: { status: "disabled" as AdminStatus } }, { new: true }
      ).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "deactivate_dept_admin",
        target_type: "dept_admin", target_id: input.admin_id, target_name: admin.name,
      });
      return { success: true };
    }),

  reactivateDeptAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getDeptAdminModel(conn).findOneAndUpdate(
        { _id: input.admin_id }, { $set: { status: "active" as AdminStatus } }, { new: true }
      ).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "reactivate_dept_admin",
        target_type: "dept_admin", target_id: input.admin_id, target_name: admin.name,
      });
      return { success: true };
    }),

  resetDeptAdminPassword: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getDeptAdminModel(conn).findById(input.admin_id).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });

      const college = await getCollegeModel().findById(input.college_id).lean();
      const token = randomUUID();
      const redis = getRedisConnection();
      await redis.setex(
        `reset:dept_admin:${token}`, RESET_TTL,
        JSON.stringify({ id: input.admin_id, college_id: input.college_id }),
      );
      if (college) {
        sendDeptAdminPasswordReset(admin.email, token, college.slug).catch(() => {});
      }

      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "reset_admin_password",
        target_type: "dept_admin", target_id: input.admin_id, target_name: admin.name,
      });

      return { success: true };
    }),

  resendDeptAdminInvite: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const DeptAdminModel = getDeptAdminModel(conn);
      const admin = await DeptAdminModel.findById(input.admin_id).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });

      const token = randomUUID();
      await DeptAdminModel.updateOne(
        { _id: input.admin_id },
        { $set: { invite_token: token, invite_token_expires_at: inviteExpiresAt() } },
      );

      const college = await getCollegeModel().findById(input.college_id).lean();
      if (college) {
        const dept = await getDepartmentModel(conn).findById(admin.dept_id).lean();
        sendDeptAdminInvite(admin.email, token, college.slug, admin.name, dept?.name ?? "", college.name).catch(() => {});
      }

      return { success: true };
    }),

  getDeptAdminActivityLog: superAdminProcedure
    .input(z.object({
      admin_id: z.string(), college_id: z.string(),
      page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const Log = getAdminActivityLogModel(conn);
      const filter = { actor_id: input.admin_id };
      const [logs, total] = await Promise.all([
        Log.find(filter).sort({ created_at: -1 }).skip((input.page - 1) * input.limit).limit(input.limit).lean(),
        Log.countDocuments(filter),
      ]);
      return { logs, total, page: input.page, limit: input.limit };
    }),

  impersonateDeptAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (process.env.IMPERSONATION_ENABLED !== "true") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Impersonation is disabled" });
      }
      const conn = await getCollegeDb(input.college_id);
      const admin = await getDeptAdminModel(conn).findById(input.admin_id).lean();
      if (!admin || admin.status !== "active") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found or inactive" });
      }
      const college = await getCollegeModel().findById(input.college_id).lean();
      if (!college) throw new TRPCError({ code: "NOT_FOUND", message: "College not found" });

      const dept = await getDepartmentModel(conn).findById(admin.dept_id).lean();
      const secret = process.env.JWT_SECRET!;
      const impersonationToken = jwt.sign(
        {
          sub: String(admin._id), role: "dept_admin",
          college_id: input.college_id, college_slug: college.slug,
          dept_id: admin.dept_id, dept_name: dept?.name ?? "",
          admin_name: admin.name, faculty_title: admin.faculty_title,
          permissions: admin.permissions,
          _impersonated_by: ctx.user.sub,
        },
        secret,
        { expiresIn: IMPERSONATION_EXPIRY },
      );

      await logAdminAction(conn, {
        college_id: input.college_id, actor_id: ctx.user.sub, actor_role: "super_admin",
        actor_name: "Super Admin", action: "impersonate_admin",
        target_type: "dept_admin", target_id: input.admin_id, target_name: admin.name,
        dept_id: admin.dept_id, dept_name: dept?.name ?? "",
      });

      return { token: impersonationToken };
    }),

  deleteDeptAdmin: superAdminProcedure
    .input(z.object({ admin_id: z.string(), college_id: z.string() }))
    .mutation(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const admin = await getDeptAdminModel(conn).findByIdAndDelete(input.admin_id).lean();
      if (!admin) throw new TRPCError({ code: "NOT_FOUND", message: "Admin not found" });
      await getCollegeModel().updateOne({ _id: input.college_id }, { $inc: { dept_admin_count: -1 } }).catch(() => {});
      return { success: true };
    }),
});
