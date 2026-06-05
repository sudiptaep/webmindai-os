import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { Connection } from "mongoose";
import {
  buildGenericNamespace,
  DEFAULT_TOKEN_LIMIT_PER_MONTH,
  GENERIC_DEPT_CODE,
  GENERIC_DEPT_NAME,
  type CreateCollegeInput,
  type College,
} from "@college-chatbot/shared";
import { getCollegeModel } from "../models/platform/college.model";
import { getDepartmentModel } from "../models/college/department.model";
import { getDeptAdminModel } from "../models/college/dept-admin.model";
import { getStudentModel } from "../models/college/student.model";
import { getDocumentModel } from "../models/college/document.model";
import { getSubjectModel } from "../models/college/subject.model";
import { getSessionModel } from "../models/college/session.model";
import { getQueryLogModel } from "../models/college/query-log.model";
import { getCollegeDb } from "../db/college.db";
import { sendInviteEmail, sendCollegeAdminInvite } from "./email.service";
import { getCollegeAdminModel } from "../models/college/college-admin.model";

async function initCollegeDb(conn: Connection): Promise<void> {
  const models = [
    getDepartmentModel(conn),
    getCollegeAdminModel(conn),
    getDeptAdminModel(conn),
    getStudentModel(conn),
    getDocumentModel(conn),
    getSubjectModel(conn),
    getSessionModel(conn),
    getQueryLogModel(conn),
  ];
  await Promise.all(models.map((m) => m.createIndexes()));
}

export async function provisionCollege(input: CreateCollegeInput): Promise<College> {
  const { name, type, slug, owner_email, token_limit_per_month } = input;

  const College = getCollegeModel();
  const existingSlug = await College.findOne({ slug: slug.toLowerCase() }).lean();
  if (existingSlug) {
    const err = new Error("Slug already taken") as Error & { code: string };
    err.code = "SLUG_TAKEN";
    throw err;
  }

  const collegeId = randomUUID();

  const college = await College.create({
    _id: collegeId,
    name,
    type,
    slug: slug.toLowerCase(),
    status: "active",
    pinecone_prefix: `c_${collegeId}`,
    r2_prefix: `colleges/${collegeId}/`,
    mongo_db_name: `cc_${collegeId.replace(/-/g, "").slice(0, 24)}`,
    token_limit_per_month: token_limit_per_month ?? DEFAULT_TOKEN_LIMIT_PER_MONTH,
    tokens_used_this_month: 0,
  });

  // Create local upload folder for this college
  const uploadsRoot = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
  fs.mkdirSync(path.join(uploadsRoot, "colleges", collegeId), { recursive: true });

  try {
    const conn = await getCollegeDb(collegeId);
    await initCollegeDb(conn);

    // Generic Department — always created, never deleted
    const genericDeptId = randomUUID();
    const Department = getDepartmentModel(conn);
    await Department.create({
      _id: genericDeptId,
      college_id: collegeId,
      name: GENERIC_DEPT_NAME,
      code: GENERIC_DEPT_CODE,
      type: "generic",
      is_generic: true,
      cannot_delete: true,
      pinecone_namespace: buildGenericNamespace(collegeId),
    });

    // College Admin (Principal) — invited, no password until accept-invite
    const CollegeAdmin = getCollegeAdminModel(conn);
    const inviteToken = randomUUID();
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const owner = await CollegeAdmin.create({
      college_id: collegeId,
      name: owner_email.split("@")[0],
      email: owner_email.toLowerCase(),
      password_hash: "",
      admin_title: "Principal",
      permissions: {
        can_create_dept_admins: true, can_deactivate_dept_admins: true,
        can_view_student_list: true, can_export_reports: true, can_view_cost_usage: false,
      },
      role: "college_admin",
      status: "invited",
      invite_token: inviteToken,
      invite_token_expires_at: inviteExpiresAt,
      college_admin_count: 1,
    });

    await College.updateOne(
      { _id: collegeId },
      { owner_admin_id: String(owner._id), primary_contact_email: owner_email.toLowerCase(), college_admin_count: 1 },
    );

    // Non-blocking: email failure must not roll back provisioning
    sendCollegeAdminInvite(owner_email, inviteToken, college.slug, owner.name, "Principal", college.name).catch((err) => {
      console.error("[provision] invite email failed:", err?.message);
    });

    return college.toObject() as unknown as College;
  } catch (err) {
    await College.updateOne({ _id: collegeId }, { status: "deleted" });
    throw err;
  }
}

export async function assignDeptAdmin(
  college_id: string,
  email: string,
  dept_id: string,
): Promise<void> {
  const conn = await getCollegeDb(college_id);
  const DeptAdmin = getDeptAdminModel(conn);
  const College = getCollegeModel();

  const existing = await DeptAdmin.findOne({ email: email.toLowerCase() }).lean();
  if (existing) {
    // Dept admin already exists in this college — do not duplicate
    return;
  }

  const token = randomUUID();
  const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await DeptAdmin.create({
    college_id,
    dept_id,
    name: email.split("@")[0],
    email: email.toLowerCase(),
    password_hash: "",
    role: "dept_admin",
    permissions: {
      can_upload_documents: true, can_delete_documents: true,
      can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
    },
    status: "invited",
    invite_token: token,
    invite_token_expires_at: inviteExpiresAt,
    invited_by_role: "super_admin",
  });

  const collegeDoc = await College.findById(college_id).lean();
  if (collegeDoc) {
    sendInviteEmail(email, token, collegeDoc.slug).catch((err) => {
      console.error("[assignDeptAdmin] invite email failed:", err?.message);
    });
  }
}
