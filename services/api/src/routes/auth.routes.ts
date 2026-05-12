import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  GENERIC_DEPT_CODE,
  isSuperAdmin,
  isDeptAdmin,
  isStudent,
  type DeptAdminJWTPayload,
  type StudentJWTPayload,
  type SuperAdminJWTPayload,
  type AnyJWTPayload,
} from "@college-chatbot/shared";
import { getCollegeModel } from "../models/platform/college.model";
import { getPlatformAdminModel } from "../models/platform/platform-admin.model";
import { getCollegeDb } from "../db/college.db";
import { getDeptAdminModel } from "../models/college/dept-admin.model";
import { getStudentModel } from "../models/college/student.model";
import { getDepartmentModel } from "../models/college/department.model";
import { getDocumentModel } from "../models/college/document.model";
import { getRedisConnection } from "../services/queue.service";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../services/email.service";

const RESET_TOKEN_TTL = 3600;      // 1 hour
const VERIFY_TOKEN_TTL = 86400;    // 24 hours
const STUDENT_APP_URL = process.env.STUDENT_APP_URL ?? "http://localhost:3001";
const ADMIN_APP_URL = process.env.ADMIN_APP_URL ?? "http://localhost:3002";

// ─── helpers ────────────────────────────────────────────────────────────────

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // seconds

function signAccess(payload: Omit<AnyJWTPayload, "iat" | "exp">): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: ACCESS_TOKEN_TTL } as jwt.SignOptions);
}

function signRefresh(payload: Omit<AnyJWTPayload, "iat" | "exp">): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: REFRESH_TOKEN_TTL } as jwt.SignOptions);
}

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie("refresh_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    domain:
      process.env.NODE_ENV === "production"
        ? `.${process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? "yourplatform.com"}`
        : undefined,
    maxAge: COOKIE_MAX_AGE,
    path: "/api/v1/auth",
  });
}

async function resolveCollegeBySlug(slug: string) {
  const College = getCollegeModel();
  const college = await College.findOne({ slug: slug.toLowerCase(), status: "active" }).lean();
  return college;
}

// ─── schemas ────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const StudentRegisterSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  dept_id: z.string().optional(),
  semester: z.number().int().min(1).max(12),
  roll_number: z.string().optional(),
});

// ─── route plugin ────────────────────────────────────────────────────────────

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // POST /api/v1/auth/super-admin/login
  fastify.post("/super-admin/login", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { email, password } = parsed.data;

    const PlatformAdmin = getPlatformAdminModel();
    const admin = await PlatformAdmin.findOne({ email }).lean();
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }

    const jwtPayload: Omit<SuperAdminJWTPayload, "iat" | "exp"> = {
      sub: String(admin._id),
      role: "super_admin",
    };
    const accessToken = signAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken);

    return reply.send({
      accessToken,
      user: { id: String(admin._id), name: admin.name, email: admin.email, role: "super_admin" },
    });
  });

  // POST /api/v1/auth/dept-admin/login?college_slug=
  fastify.post("/dept-admin/login", async (request: FastifyRequest, reply: FastifyReply) => {
    const { college_slug } = request.query as { college_slug?: string };
    if (!college_slug) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "college_slug is required" });
    }

    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { email, password } = parsed.data;

    const college = await resolveCollegeBySlug(college_slug);
    if (!college) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "College not found" });
    }

    const conn = await getCollegeDb(String(college._id));
    const DeptAdmin = getDeptAdminModel(conn);
    const admin = await DeptAdmin.findOne({ email }).lean();
    if (!admin || admin.status === "disabled" || !(await bcrypt.compare(password, admin.password_hash))) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }

    await DeptAdmin.updateOne({ _id: admin._id }, { last_login: new Date() });

    const jwtPayload: Omit<DeptAdminJWTPayload, "iat" | "exp"> = {
      sub: String(admin._id),
      role: "dept_admin",
      college_id: String(college._id),
      dept_ids: admin.dept_ids,
      is_college_owner: admin.is_college_owner,
    };
    const accessToken = signAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken);

    return reply.send({
      accessToken,
      user: {
        id: String(admin._id),
        name: admin.name,
        email: admin.email,
        role: "dept_admin",
        college_id: String(college._id),
        dept_ids: admin.dept_ids,
        is_college_owner: admin.is_college_owner,
      },
    });
  });

  // POST /api/v1/auth/student/register?college_slug=
  fastify.post("/student/register", async (request: FastifyRequest, reply: FastifyReply) => {
    const { college_slug } = request.query as { college_slug?: string };
    if (!college_slug) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "college_slug is required" });
    }

    const parsed = StudentRegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { name, email, password, dept_id, semester, roll_number } = parsed.data;

    const college = await resolveCollegeBySlug(college_slug);
    if (!college) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "College not found" });
    }
    const collegeId = String(college._id);
    const conn = await getCollegeDb(collegeId);

    const Department = getDepartmentModel(conn);
    const Student = getStudentModel(conn);
    const Document = getDocumentModel(conn);

    // Resolve dept: use provided dept_id or fall back to generic dept
    let resolvedDeptId: string;
    if (dept_id) {
      const dept = await Department.findById(dept_id).lean();
      if (!dept) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Department not found" });
      }
      resolvedDeptId = dept_id;
    } else {
      const genericDept = await Department.findOne({ college_id: collegeId, code: GENERIC_DEPT_CODE }).lean();
      if (!genericDept) {
        return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "No department found for this college" });
      }
      resolvedDeptId = String(genericDept._id);
    }

    // Check email uniqueness
    const existing = await Student.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      return reply.status(409).send({ statusCode: 409, error: "Conflict", message: "Email already registered" });
    }

    // Resolve effective_dept_id: does selected dept have ≥1 completed document?
    const hasCompletedDoc = await Document.exists({ dept_id: resolvedDeptId, ingestion_status: "completed" });
    let effectiveDeptId = resolvedDeptId;
    let usingGenericFallback = false;

    if (!hasCompletedDoc) {
      const genericDept = await Department.findOne({ college_id: collegeId, code: GENERIC_DEPT_CODE }).lean();
      if (genericDept && String(genericDept._id) !== resolvedDeptId) {
        effectiveDeptId = String(genericDept._id);
        usingGenericFallback = true;
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const student = await Student.create({
      college_id: collegeId,
      dept_id: resolvedDeptId,
      effective_dept_id: effectiveDeptId,
      using_generic_fallback: usingGenericFallback,
      name,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      roll_number,
      semester,
    });

    // Registration requires admin approval — do not issue a token yet
    return reply.status(201).send({
      status: "pending_approval",
      message: "Registration submitted. Your account is awaiting admin approval.",
    });
  });

  // POST /api/v1/auth/student/login?college_slug=
  fastify.post("/student/login", async (request: FastifyRequest, reply: FastifyReply) => {
    const { college_slug } = request.query as { college_slug?: string };
    if (!college_slug) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "college_slug is required" });
    }

    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { email, password } = parsed.data;

    const college = await resolveCollegeBySlug(college_slug);
    if (!college) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "College not found" });
    }
    const collegeId = String(college._id);
    const conn = await getCollegeDb(collegeId);
    const Student = getStudentModel(conn);

    const student = await Student.findOne({ email: email.toLowerCase() }).lean();
    if (!student || !(await bcrypt.compare(password, student.password_hash))) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }
    if (student.status === "pending_approval") {
      return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Your account is pending admin approval." });
    }
    if (student.status === "disabled") {
      return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Your account has been disabled." });
    }

    await Student.updateOne({ _id: student._id }, { last_login: new Date() });

    const jwtPayload: Omit<StudentJWTPayload, "iat" | "exp"> = {
      sub: String(student._id),
      role: "student",
      college_id: collegeId,
      college_type: college.type as "engineering" | "medical" | "other",
      dept_id: student.dept_id,
      effective_dept_id: student.effective_dept_id,
      using_generic_fallback: student.using_generic_fallback,
      semester: student.semester,
    };
    const accessToken = signAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken);

    return reply.send({
      accessToken,
      user: {
        id: String(student._id),
        name: student.name,
        email: student.email,
        role: "student",
        college_id: collegeId,
        college_type: college.type,
        dept_id: student.dept_id,
        effective_dept_id: student.effective_dept_id,
        using_generic_fallback: student.using_generic_fallback,
        semester: student.semester,
      },
    });
  });

  // POST /api/v1/auth/refresh
  fastify.post("/refresh", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies?.refresh_token;
    if (!token) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "No refresh token" });
    }

    let payload: AnyJWTPayload;
    try {
      payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as AnyJWTPayload;
    } catch {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid refresh token" });
    }

    // Verify user still exists and is active
    if (isSuperAdmin(payload)) {
      const PlatformAdmin = getPlatformAdminModel();
      const admin = await PlatformAdmin.findById(payload.sub).lean();
      if (!admin) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "User not found" });
      }
    } else if (isDeptAdmin(payload)) {
      const conn = await getCollegeDb(payload.college_id);
      const admin = await getDeptAdminModel(conn).findById(payload.sub).lean();
      if (!admin || admin.status === "disabled") {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "User not found or disabled" });
      }
    } else if (isStudent(payload)) {
      const conn = await getCollegeDb(payload.college_id);
      const student = await getStudentModel(conn).findById(payload.sub).lean();
      if (!student || student.status === "disabled") {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "User not found or disabled" });
      }
      // Reflect latest effective_dept_id (may have changed from fallback)
      (payload as StudentJWTPayload).effective_dept_id = student.effective_dept_id;
      (payload as StudentJWTPayload).using_generic_fallback = student.using_generic_fallback;
      (payload as StudentJWTPayload).semester = student.semester;
    }

    const basePayload = { ...payload } as Omit<AnyJWTPayload, "iat" | "exp">;
    delete (basePayload as Record<string, unknown>).iat;
    delete (basePayload as Record<string, unknown>).exp;

    const newAccessToken = signAccess(basePayload);
    const newRefreshToken = signRefresh(basePayload);
    setRefreshCookie(reply, newRefreshToken);

    return reply.send({ accessToken: newAccessToken });
  });

  // POST /api/v1/auth/logout
  fastify.post("/logout", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie("refresh_token", { path: "/api/v1/auth" });
    return reply.send({ success: true });
  });

  // GET /api/v1/auth/colleges (public — list active colleges for registration dropdown)
  fastify.get("/colleges", async (_request: FastifyRequest, reply: FastifyReply) => {
    const College = getCollegeModel();
    const colleges = await College.find({ status: "active" }).select("_id name slug type").sort({ name: 1 }).lean();
    return reply.send(colleges);
  });

  // GET /api/v1/auth/departments?college_slug= (public)
  fastify.get("/departments", async (request: FastifyRequest, reply: FastifyReply) => {
    const { college_slug } = request.query as { college_slug?: string };
    if (!college_slug) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "college_slug is required" });
    }
    const college = await resolveCollegeBySlug(college_slug);
    if (!college) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "College not found" });
    }
    const conn = await getCollegeDb(String(college._id));
    const Department = getDepartmentModel(conn);
    const depts = await Department.find({ deleted: { $ne: true } }).select("_id name code type is_generic").lean();
    return reply.send(depts);
  });

  // POST /api/v1/auth/forgot-password
  fastify.post("/forgot-password", async (request: FastifyRequest, reply: FastifyReply) => {
    const ForgotSchema = z.object({
      email: z.string().email(),
      role: z.enum(["student", "dept_admin"]),
      college_slug: z.string().optional(),
    });
    const parsed = ForgotSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { email, role, college_slug } = parsed.data;

    const redis = getRedisConnection();
    let userId: string | null = null;
    let appUrl = STUDENT_APP_URL;

    if (role === "student") {
      if (!college_slug) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "college_slug required for student" });
      }
      const college = await resolveCollegeBySlug(college_slug);
      if (college) {
        const conn = await getCollegeDb(String(college._id));
        const student = await getStudentModel(conn).findOne({ email: email.toLowerCase() }).lean();
        if (student) userId = JSON.stringify({ id: String(student._id), college_id: String(college._id), role: "student" });
      }
      appUrl = STUDENT_APP_URL;
    } else {
      if (!college_slug) {
        return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "college_slug required for dept_admin" });
      }
      const college = await resolveCollegeBySlug(college_slug);
      if (college) {
        const conn = await getCollegeDb(String(college._id));
        const admin = await getDeptAdminModel(conn).findOne({ email: email.toLowerCase() }).lean();
        if (admin) userId = JSON.stringify({ id: String(admin._id), college_id: String(college._id), role: "dept_admin" });
      }
      appUrl = ADMIN_APP_URL;
    }

    // Always return 200 — don't reveal if email exists
    if (userId) {
      const token = crypto.randomBytes(32).toString("hex");
      await redis.setex(`reset:${token}`, RESET_TOKEN_TTL, userId);
      await sendPasswordResetEmail(email, token, appUrl).catch(() => {});
    }

    return reply.send({ message: "If that email exists, a reset link has been sent." });
  });

  // POST /api/v1/auth/reset-password
  fastify.post("/reset-password", async (request: FastifyRequest, reply: FastifyReply) => {
    const ResetSchema = z.object({
      token: z.string().min(1),
      new_password: z.string().min(8, "Password must be at least 8 characters"),
    });
    const parsed = ResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { token, new_password } = parsed.data;

    const redis = getRedisConnection();
    const raw = await redis.get(`reset:${token}`);
    if (!raw) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Invalid or expired reset token" });
    }

    const { id, college_id, role } = JSON.parse(raw) as { id: string; college_id: string; role: string };
    const passwordHash = await bcrypt.hash(new_password, 12);

    if (role === "student") {
      const conn = await getCollegeDb(college_id);
      await getStudentModel(conn).updateOne({ _id: id }, { password_hash: passwordHash });
    } else {
      const conn = await getCollegeDb(college_id);
      await getDeptAdminModel(conn).updateOne({ _id: id }, { password_hash: passwordHash });
    }

    await redis.del(`reset:${token}`);
    return reply.send({ message: "Password updated successfully." });
  });

  // POST /api/v1/auth/send-verification (student auth required via JWT in header)
  fastify.post("/send-verification", async (request: FastifyRequest, reply: FastifyReply) => {
    const SendVerifySchema = z.object({
      college_slug: z.string().min(1),
      student_id: z.string().min(1),
      email: z.string().email(),
    });
    const parsed = SendVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { college_slug, student_id, email } = parsed.data;
    const college = await resolveCollegeBySlug(college_slug);
    if (!college) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "College not found" });
    }
    const redis = getRedisConnection();
    const token = crypto.randomBytes(32).toString("hex");
    await redis.setex(
      `verify:${token}`,
      VERIFY_TOKEN_TTL,
      JSON.stringify({ student_id, college_id: String(college._id) })
    );
    await sendVerificationEmail(email, token, STUDENT_APP_URL).catch(() => {});
    return reply.send({ message: "Verification email sent." });
  });

  // GET /api/v1/auth/verify-email?token=
  fastify.get("/verify-email", async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.query as { token?: string };
    if (!token) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "token is required" });
    }
    const redis = getRedisConnection();
    const raw = await redis.get(`verify:${token}`);
    if (!raw) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Invalid or expired verification token" });
    }
    const { student_id, college_id } = JSON.parse(raw) as { student_id: string; college_id: string };
    const conn = await getCollegeDb(college_id);
    await getStudentModel(conn).updateOne({ _id: student_id }, { email_verified: true });
    await redis.del(`verify:${token}`);
    return reply.send({ message: "Email verified successfully." });
  });

  // POST /api/v1/auth/dept-admin/accept-invite
  fastify.post("/dept-admin/accept-invite", async (request: FastifyRequest, reply: FastifyReply) => {
    const AcceptInviteSchema = z.object({
      token: z.string().min(1),
      password: z.string().min(8, "Password must be at least 8 characters"),
      name: z.string().min(1),
    });

    const parsed = AcceptInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { token, password, name } = parsed.data;

    let invitePayload: { email: string; college_id: string; type: string };
    try {
      invitePayload = jwt.verify(token, process.env.JWT_SECRET!) as typeof invitePayload;
    } catch {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid or expired invite token" });
    }

    if (invitePayload.type !== "invite") {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Not an invite token" });
    }

    const conn = await getCollegeDb(invitePayload.college_id);
    const DeptAdmin = getDeptAdminModel(conn);
    const admin = await DeptAdmin.findOne({ email: invitePayload.email, status: "invited" }).lean();
    if (!admin) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "Invite not found or already accepted" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await DeptAdmin.updateOne(
      { _id: admin._id },
      { password_hash: passwordHash, name, status: "active", last_login: new Date() },
    );

    const jwtPayload: Omit<DeptAdminJWTPayload, "iat" | "exp"> = {
      sub: String(admin._id),
      role: "dept_admin",
      college_id: invitePayload.college_id,
      dept_ids: admin.dept_ids,
      is_college_owner: admin.is_college_owner,
    };
    const accessToken = signAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken);

    return reply.send({
      accessToken,
      user: {
        id: String(admin._id),
        name,
        email: admin.email,
        role: "dept_admin",
        college_id: invitePayload.college_id,
        dept_ids: admin.dept_ids,
        is_college_owner: admin.is_college_owner,
      },
    });
  });
};
