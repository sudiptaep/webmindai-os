import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import speakeasy from "speakeasy";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  GENERIC_DEPT_CODE,
  isSuperAdmin,
  isCollegeAdmin,
  isDeptAdmin,
  isStudent,
  type CollegeAdminJWTPayload,
  type DeptAdminJWTPayload,
  type StudentJWTPayload,
  type SuperAdminJWTPayload,
  type AnyJWTPayload,
} from "@college-chatbot/shared";
import { getCollegeModel } from "../models/platform/college.model";
import { getPlatformAdminModel } from "../models/platform/platform-admin.model";
import { getCollegeDb } from "../db/college.db";
import { getCollegeAdminModel } from "../models/college/college-admin.model";
import { getDeptAdminModel } from "../models/college/dept-admin.model";
import { getStudentModel } from "../models/college/student.model";
import { getDepartmentModel } from "../models/college/department.model";
import { getDocumentModel } from "../models/college/document.model";
import { getRedisConnection } from "../services/queue.service";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendCollegeAdminPasswordReset,
  sendDeptAdminPasswordReset,
} from "../services/email.service";

const RESET_TOKEN_TTL = 3600;      // 1 hour
const VERIFY_TOKEN_TTL = 86400;    // 24 hours
const MFA_SESSION_TTL = 300;       // 5 minutes
const STUDENT_APP_URL = process.env.STUDENT_APP_URL ?? "http://localhost:3001";
const ADMIN_APP_URL = process.env.ADMIN_APP_URL ?? "http://localhost:3002";
const SA_MAX_ATTEMPTS = Number(process.env.SUPER_ADMIN_LOGIN_MAX_ATTEMPTS ?? 5);
const SA_LOCKOUT_MINUTES = Number(process.env.SUPER_ADMIN_LOCKOUT_MINUTES ?? 30);

// ─── helpers ────────────────────────────────────────────────────────────────

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
const ADMIN_REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // 30 days for admins

function signAccess(payload: Omit<AnyJWTPayload, "iat" | "exp">): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: ACCESS_TOKEN_TTL } as jwt.SignOptions);
}

function signSuperAdminAccess(payload: Omit<SuperAdminJWTPayload, "iat" | "exp">): string {
  const secret = process.env.SUPER_ADMIN_JWT_SECRET ?? process.env.JWT_SECRET!;
  const expiry = (process.env.SUPER_ADMIN_JWT_EXPIRY ?? "8h") as jwt.SignOptions["expiresIn"];
  return jwt.sign(payload, secret, { expiresIn: expiry } as jwt.SignOptions);
}

function signCollegeAdminAccess(payload: Omit<CollegeAdminJWTPayload, "iat" | "exp">): string {
  const secret = process.env.COLLEGE_ADMIN_JWT_SECRET ?? process.env.JWT_SECRET!;
  const expiry = (process.env.COLLEGE_ADMIN_JWT_EXPIRY ?? "8h") as jwt.SignOptions["expiresIn"];
  return jwt.sign(payload, secret, { expiresIn: expiry } as jwt.SignOptions);
}

function signRefresh(payload: Omit<AnyJWTPayload, "iat" | "exp">): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: REFRESH_TOKEN_TTL } as jwt.SignOptions);
}

function setRefreshCookie(reply: FastifyReply, token: string, maxAge = COOKIE_MAX_AGE): void {
  reply.setCookie("refresh_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    domain:
      process.env.NODE_ENV === "production"
        ? `.${process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? "yourplatform.com"}`
        : undefined,
    maxAge,
    path: "/api/v1/auth",
  });
}

async function resolveCollegeBySlug(slug: string) {
  const College = getCollegeModel();
  return College.findOne({ slug: slug.toLowerCase(), status: "active" }).lean();
}

// ─── schemas ────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const AcceptInviteSchema = z.object({
  token: z.string().uuid(),
  password: z.string().min(8, "Password must be at least 8 characters"),
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

  // ── Super Admin ─────────────────────────────────────────────────────────────

  // POST /api/v1/auth/super-admin/login
  fastify.post("/super-admin/login", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { email, password } = parsed.data;

    const PlatformAdmin = getPlatformAdminModel();
    const admin = await PlatformAdmin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }

    if (admin.locked_until && admin.locked_until > new Date()) {
      const minutesLeft = Math.ceil((admin.locked_until.getTime() - Date.now()) / 60000);
      return reply.status(429).send({
        statusCode: 429, error: "Account Locked",
        message: `Account locked. Try again in ${minutesLeft} minute(s).`,
      });
    }

    const passwordOk = await bcrypt.compare(password, admin.password_hash);
    if (!passwordOk) {
      const attempts = (admin.failed_login_attempts ?? 0) + 1;
      const update: Record<string, unknown> = { failed_login_attempts: attempts };
      if (attempts >= SA_MAX_ATTEMPTS) {
        update.locked_until = new Date(Date.now() + SA_LOCKOUT_MINUTES * 60 * 1000);
      }
      await PlatformAdmin.updateOne({ _id: admin._id }, { $set: update });
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }

    await PlatformAdmin.updateOne(
      { _id: admin._id },
      { $set: { failed_login_attempts: 0, locked_until: null, last_login: new Date() } },
    );

    const jwtPayload: Omit<SuperAdminJWTPayload, "iat" | "exp"> = { sub: String(admin._id), role: "super_admin" };

    if (admin.mfa_enabled && admin.mfa_secret) {
      const mfaSessionToken = crypto.randomUUID();
      const redis = getRedisConnection();
      await redis.setex(`mfa_session:${mfaSessionToken}`, MFA_SESSION_TTL, String(admin._id));
      return reply.send({ requires_mfa: true, mfa_session_token: mfaSessionToken });
    }

    const accessToken = signSuperAdminAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken);

    return reply.send({
      access_token: accessToken,
      user: {
        id: String(admin._id), name: admin.name, email: admin.email,
        role: "super_admin", avatar_initials: admin.avatar_initials, last_login: admin.last_login,
      },
    });
  });

  // POST /api/v1/auth/super-admin/mfa-verify
  fastify.post("/super-admin/mfa-verify", async (request: FastifyRequest, reply: FastifyReply) => {
    const MfaSchema = z.object({ mfa_session_token: z.string().uuid(), totp_code: z.string().length(6) });
    const parsed = MfaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { mfa_session_token, totp_code } = parsed.data;

    const redis = getRedisConnection();
    const adminId = await redis.get(`mfa_session:${mfa_session_token}`);
    if (!adminId) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "MFA session expired or invalid" });
    }

    const PlatformAdmin = getPlatformAdminModel();
    const admin = await PlatformAdmin.findById(adminId).lean();
    if (!admin || !admin.mfa_secret) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Admin not found" });
    }

    const valid = speakeasy.totp.verify({
      secret: admin.mfa_secret, encoding: "base32", token: totp_code,
      window: Number(process.env.MFA_TOTP_WINDOW ?? 1),
    });
    if (!valid) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid authenticator code" });
    }

    await redis.del(`mfa_session:${mfa_session_token}`);
    const jwtPayload: Omit<SuperAdminJWTPayload, "iat" | "exp"> = { sub: adminId, role: "super_admin" };
    const accessToken = signSuperAdminAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken);

    return reply.send({
      access_token: accessToken,
      user: { id: adminId, name: admin.name, email: admin.email, role: "super_admin" },
    });
  });

  // ── College Admin ────────────────────────────────────────────────────────────

  // POST /api/v1/auth/college-admin/login?college_slug=
  fastify.post("/college-admin/login", async (request: FastifyRequest, reply: FastifyReply) => {
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
    const CollegeAdmin = getCollegeAdminModel(conn);
    const admin = await CollegeAdmin.findOne({ email: email.toLowerCase() }).lean();

    if (!admin || admin.status === "disabled") {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }
    if (admin.status === "invited") {
      return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Please accept your invitation first." });
    }
    if (!(await bcrypt.compare(password, admin.password_hash))) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }

    await CollegeAdmin.updateOne(
      { _id: admin._id },
      { $set: { last_login: new Date(), last_login_ip: request.ip, $inc: { login_count: 1 } } },
    );

    const jwtPayload: Omit<CollegeAdminJWTPayload, "iat" | "exp"> = {
      sub: String(admin._id),
      role: "college_admin",
      college_id: String(college._id),
      college_slug: college.slug,
      college_name: college.name,
      admin_name: admin.name,
      admin_title: admin.admin_title,
      permissions: admin.permissions,
    };
    const accessToken = signCollegeAdminAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken, ADMIN_REFRESH_MAX_AGE);

    return reply.send({
      accessToken,
      user: {
        id: String(admin._id), name: admin.name, email: admin.email,
        role: "college_admin", college_id: String(college._id), college_slug: college.slug,
        admin_title: admin.admin_title, permissions: admin.permissions,
      },
    });
  });

  // POST /api/v1/auth/college-admin/accept-invite
  fastify.post("/college-admin/accept-invite", async (request: FastifyRequest, reply: FastifyReply) => {
    const Schema = AcceptInviteSchema.extend({ college_slug: z.string().min(1) });
    const parsed = Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { token, password, college_slug } = parsed.data;

    const college = await resolveCollegeBySlug(college_slug);
    if (!college) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "College not found" });
    }

    const conn = await getCollegeDb(String(college._id));
    const CollegeAdmin = getCollegeAdminModel(conn);
    const admin = await CollegeAdmin.findOne({
      invite_token: token,
      status: "invited",
      invite_token_expires_at: { $gt: new Date() },
    }).lean();

    if (!admin) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Invalid or expired invitation link" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await CollegeAdmin.updateOne(
      { _id: admin._id },
      {
        $set: {
          password_hash: passwordHash, status: "active",
          invite_token: null, invite_token_expires_at: null,
          invite_accepted_at: new Date(), must_change_password: false,
          last_login: new Date(), last_login_ip: request.ip,
        },
        $inc: { login_count: 1 },
      },
    );

    const jwtPayload: Omit<CollegeAdminJWTPayload, "iat" | "exp"> = {
      sub: String(admin._id), role: "college_admin",
      college_id: String(college._id), college_slug: college.slug, college_name: college.name,
      admin_name: admin.name, admin_title: admin.admin_title, permissions: admin.permissions,
    };
    const accessToken = signCollegeAdminAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken, ADMIN_REFRESH_MAX_AGE);

    return reply.send({
      accessToken,
      user: {
        id: String(admin._id), name: admin.name, email: admin.email,
        role: "college_admin", college_id: String(college._id),
      },
    });
  });

  // POST /api/v1/auth/college-admin/forgot-password
  fastify.post("/college-admin/forgot-password", async (request: FastifyRequest, reply: FastifyReply) => {
    const Schema = z.object({ email: z.string().email(), college_slug: z.string().min(1) });
    const parsed = Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { email, college_slug } = parsed.data;

    const college = await resolveCollegeBySlug(college_slug);
    if (college) {
      const conn = await getCollegeDb(String(college._id));
      const admin = await getCollegeAdminModel(conn).findOne({ email: email.toLowerCase(), status: "active" }).lean();
      if (admin) {
        const token = crypto.randomUUID();
        const redis = getRedisConnection();
        await redis.setex(
          `reset:college_admin:${token}`,
          RESET_TOKEN_TTL,
          JSON.stringify({ id: String(admin._id), college_id: String(college._id) }),
        );
        await sendCollegeAdminPasswordReset(email, token, college_slug).catch(() => {});
      }
    }

    return reply.send({ message: "If that email exists, a reset link has been sent." });
  });

  // POST /api/v1/auth/college-admin/reset-password
  fastify.post("/college-admin/reset-password", async (request: FastifyRequest, reply: FastifyReply) => {
    const Schema = z.object({ token: z.string().uuid(), new_password: z.string().min(8) });
    const parsed = Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { token, new_password } = parsed.data;

    const redis = getRedisConnection();
    const raw = await redis.get(`reset:college_admin:${token}`);
    if (!raw) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Invalid or expired reset token" });
    }

    const { id, college_id } = JSON.parse(raw) as { id: string; college_id: string };
    const passwordHash = await bcrypt.hash(new_password, 12);
    const conn = await getCollegeDb(college_id);
    await getCollegeAdminModel(conn).updateOne({ _id: id }, { $set: { password_hash: passwordHash } });
    await redis.del(`reset:college_admin:${token}`);

    return reply.send({ message: "Password updated successfully." });
  });

  // ── Dept Admin ────────────────────────────────────────────────────────────────

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
    const DeptAdminModel = getDeptAdminModel(conn);
    const admin = await DeptAdminModel.findOne({ email: email.toLowerCase() }).lean();

    if (!admin || admin.status === "disabled") {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }
    if (admin.status === "invited") {
      return reply.status(403).send({ statusCode: 403, error: "Forbidden", message: "Please accept your invitation first." });
    }
    if (!(await bcrypt.compare(password, admin.password_hash))) {
      return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "Invalid credentials" });
    }

    // Fetch dept name for JWT
    const dept = await getDepartmentModel(conn).findById(admin.dept_id).lean();

    await DeptAdminModel.updateOne(
      { _id: admin._id },
      { $set: { last_login: new Date(), last_login_ip: request.ip }, $inc: { login_count: 1 } },
    );

    const jwtPayload: Omit<DeptAdminJWTPayload, "iat" | "exp"> = {
      sub: String(admin._id),
      role: "dept_admin",
      college_id: String(college._id),
      college_slug: college.slug,
      dept_id: admin.dept_id,
      dept_name: dept?.name ?? "",
      admin_name: admin.name,
      faculty_title: admin.faculty_title,
      permissions: admin.permissions,
    };
    const accessToken = signAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken, ADMIN_REFRESH_MAX_AGE);

    return reply.send({
      accessToken,
      user: {
        id: String(admin._id), name: admin.name, email: admin.email,
        role: "dept_admin", college_id: String(college._id), college_slug: college.slug,
        dept_id: admin.dept_id, dept_name: dept?.name ?? "",
        faculty_title: admin.faculty_title, permissions: admin.permissions,
      },
    });
  });

  // POST /api/v1/auth/dept-admin/accept-invite
  fastify.post("/dept-admin/accept-invite", async (request: FastifyRequest, reply: FastifyReply) => {
    const Schema = AcceptInviteSchema.extend({ college_slug: z.string().min(1) });
    const parsed = Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { token, password, college_slug } = parsed.data;

    const college = await resolveCollegeBySlug(college_slug);
    if (!college) {
      return reply.status(404).send({ statusCode: 404, error: "Not Found", message: "College not found" });
    }

    const conn = await getCollegeDb(String(college._id));
    const DeptAdminModel = getDeptAdminModel(conn);
    const admin = await DeptAdminModel.findOne({
      invite_token: token,
      status: "invited",
      invite_token_expires_at: { $gt: new Date() },
    }).lean();

    if (!admin) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Invalid or expired invitation link" });
    }

    const dept = await getDepartmentModel(conn).findById(admin.dept_id).lean();
    const passwordHash = await bcrypt.hash(password, 12);

    await DeptAdminModel.updateOne(
      { _id: admin._id },
      {
        $set: {
          password_hash: passwordHash, status: "active",
          invite_token: null, invite_token_expires_at: null,
          invite_accepted_at: new Date(), must_change_password: false,
          last_login: new Date(), last_login_ip: request.ip,
        },
        $inc: { login_count: 1 },
      },
    );

    const jwtPayload: Omit<DeptAdminJWTPayload, "iat" | "exp"> = {
      sub: String(admin._id), role: "dept_admin",
      college_id: String(college._id), college_slug: college.slug,
      dept_id: admin.dept_id, dept_name: dept?.name ?? "",
      admin_name: admin.name, faculty_title: admin.faculty_title,
      permissions: admin.permissions,
    };
    const accessToken = signAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken, ADMIN_REFRESH_MAX_AGE);

    return reply.send({
      accessToken,
      user: {
        id: String(admin._id), name: admin.name, email: admin.email,
        role: "dept_admin", college_id: String(college._id), dept_id: admin.dept_id,
      },
    });
  });

  // POST /api/v1/auth/dept-admin/forgot-password
  fastify.post("/dept-admin/forgot-password", async (request: FastifyRequest, reply: FastifyReply) => {
    const Schema = z.object({ email: z.string().email(), college_slug: z.string().min(1) });
    const parsed = Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { email, college_slug } = parsed.data;

    const college = await resolveCollegeBySlug(college_slug);
    if (college) {
      const conn = await getCollegeDb(String(college._id));
      const admin = await getDeptAdminModel(conn).findOne({ email: email.toLowerCase(), status: "active" }).lean();
      if (admin) {
        const token = crypto.randomUUID();
        const redis = getRedisConnection();
        await redis.setex(
          `reset:dept_admin:${token}`,
          RESET_TOKEN_TTL,
          JSON.stringify({ id: String(admin._id), college_id: String(college._id) }),
        );
        await sendDeptAdminPasswordReset(email, token, college_slug).catch(() => {});
      }
    }

    return reply.send({ message: "If that email exists, a reset link has been sent." });
  });

  // POST /api/v1/auth/dept-admin/reset-password
  fastify.post("/dept-admin/reset-password", async (request: FastifyRequest, reply: FastifyReply) => {
    const Schema = z.object({ token: z.string().uuid(), new_password: z.string().min(8) });
    const parsed = Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ statusCode: 422, error: "Unprocessable Entity", message: parsed.error.message });
    }
    const { token, new_password } = parsed.data;

    const redis = getRedisConnection();
    const raw = await redis.get(`reset:dept_admin:${token}`);
    if (!raw) {
      return reply.status(400).send({ statusCode: 400, error: "Bad Request", message: "Invalid or expired reset token" });
    }

    const { id, college_id } = JSON.parse(raw) as { id: string; college_id: string };
    const passwordHash = await bcrypt.hash(new_password, 12);
    const conn = await getCollegeDb(college_id);
    await getDeptAdminModel(conn).updateOne({ _id: id }, { $set: { password_hash: passwordHash } });
    await redis.del(`reset:dept_admin:${token}`);

    return reply.send({ message: "Password updated successfully." });
  });

  // ── Student ──────────────────────────────────────────────────────────────────

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

    const existing = await Student.findOne({ email: email.toLowerCase() }).lean();
    if (existing) {
      return reply.status(409).send({ statusCode: 409, error: "Conflict", message: "Email already registered" });
    }

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
    await Student.create({
      college_id: collegeId, dept_id: resolvedDeptId, effective_dept_id: effectiveDeptId,
      using_generic_fallback: usingGenericFallback, name, email: email.toLowerCase(),
      password_hash: passwordHash, roll_number, semester,
    });

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
      sub: String(student._id), role: "student", college_id: collegeId,
      college_type: college.type as "engineering" | "medical" | "other",
      dept_id: student.dept_id, effective_dept_id: student.effective_dept_id,
      using_generic_fallback: student.using_generic_fallback, semester: student.semester,
    };
    const accessToken = signAccess(jwtPayload);
    const refreshToken = signRefresh(jwtPayload);
    setRefreshCookie(reply, refreshToken);

    return reply.send({
      accessToken,
      user: {
        id: String(student._id), name: student.name, email: student.email, role: "student",
        college_id: collegeId, college_type: college.type, dept_id: student.dept_id,
        effective_dept_id: student.effective_dept_id,
        using_generic_fallback: student.using_generic_fallback, semester: student.semester,
      },
    });
  });

  // ── Shared ────────────────────────────────────────────────────────────────────

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

    if (isSuperAdmin(payload)) {
      const admin = await getPlatformAdminModel().findById(payload.sub).lean();
      if (!admin) {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "User not found" });
      }
    } else if (isCollegeAdmin(payload)) {
      const conn = await getCollegeDb(payload.college_id);
      const admin = await getCollegeAdminModel(conn).findById(payload.sub).lean();
      if (!admin || admin.status === "disabled") {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "User not found or disabled" });
      }
      // Reflect latest permissions from DB in case they changed
      (payload as CollegeAdminJWTPayload).permissions = admin.permissions;
    } else if (isDeptAdmin(payload)) {
      const conn = await getCollegeDb(payload.college_id);
      const admin = await getDeptAdminModel(conn).findById(payload.sub).lean();
      if (!admin || admin.status === "disabled") {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "User not found or disabled" });
      }
      (payload as DeptAdminJWTPayload).permissions = admin.permissions;
    } else if (isStudent(payload)) {
      const conn = await getCollegeDb(payload.college_id);
      const student = await getStudentModel(conn).findById(payload.sub).lean();
      if (!student || student.status === "disabled") {
        return reply.status(401).send({ statusCode: 401, error: "Unauthorized", message: "User not found or disabled" });
      }
      (payload as StudentJWTPayload).effective_dept_id = student.effective_dept_id;
      (payload as StudentJWTPayload).using_generic_fallback = student.using_generic_fallback;
      (payload as StudentJWTPayload).semester = student.semester;
    }

    const basePayload = { ...payload } as Omit<AnyJWTPayload, "iat" | "exp">;
    delete (basePayload as Record<string, unknown>).iat;
    delete (basePayload as Record<string, unknown>).exp;

    const newAccessToken = isCollegeAdmin(payload)
      ? signCollegeAdminAccess(basePayload as Omit<CollegeAdminJWTPayload, "iat" | "exp">)
      : isSuperAdmin(payload)
      ? signSuperAdminAccess(basePayload as Omit<SuperAdminJWTPayload, "iat" | "exp">)
      : signAccess(basePayload);
    const newRefreshToken = signRefresh(basePayload);
    const maxAge = isCollegeAdmin(payload) || isDeptAdmin(payload) ? ADMIN_REFRESH_MAX_AGE : COOKIE_MAX_AGE;
    setRefreshCookie(reply, newRefreshToken, maxAge);

    return reply.send({ accessToken: newAccessToken });
  });

  // POST /api/v1/auth/logout
  fastify.post("/logout", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie("refresh_token", { path: "/api/v1/auth" });
    return reply.send({ success: true });
  });

  // GET /api/v1/auth/colleges (public)
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

  // POST /api/v1/auth/forgot-password (legacy — student + dept_admin combined)
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

    if (userId) {
      const token = crypto.randomBytes(32).toString("hex");
      await redis.setex(`reset:${token}`, RESET_TOKEN_TTL, userId);
      await sendPasswordResetEmail(email, token, appUrl).catch(() => {});
    }

    return reply.send({ message: "If that email exists, a reset link has been sent." });
  });

  // POST /api/v1/auth/reset-password (legacy — student + dept_admin combined)
  fastify.post("/reset-password", async (request: FastifyRequest, reply: FastifyReply) => {
    const ResetSchema = z.object({ token: z.string().min(1), new_password: z.string().min(8) });
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
    const conn = await getCollegeDb(college_id);

    if (role === "student") {
      await getStudentModel(conn).updateOne({ _id: id }, { password_hash: passwordHash });
    } else {
      await getDeptAdminModel(conn).updateOne({ _id: id }, { password_hash: passwordHash });
    }

    await redis.del(`reset:${token}`);
    return reply.send({ message: "Password updated successfully." });
  });

  // POST /api/v1/auth/send-verification
  fastify.post("/send-verification", async (request: FastifyRequest, reply: FastifyReply) => {
    const SendVerifySchema = z.object({
      college_slug: z.string().min(1), student_id: z.string().min(1), email: z.string().email(),
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
      `verify:${token}`, VERIFY_TOKEN_TTL,
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
};
