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
import { sendInviteEmail } from "./email.service";

async function initCollegeDb(conn: Connection): Promise<void> {
  const models = [
    getDepartmentModel(conn),
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

    // College owner (dept_admin) — invited, no usable password until accept-invite
    const tempPasswordHash = await bcrypt.hash(randomUUID(), 12);
    const DeptAdmin = getDeptAdminModel(conn);
    const owner = await DeptAdmin.create({
      college_id: collegeId,
      dept_ids: [],
      name: owner_email.split("@")[0],
      email: owner_email.toLowerCase(),
      password_hash: tempPasswordHash,
      role: "dept_admin",
      is_college_owner: true,
      status: "invited",
    });

    await College.updateOne({ _id: collegeId }, { owner_admin_id: String(owner._id) });

    // Invite token — 7 days
    const inviteToken = jwt.sign(
      { email: owner_email.toLowerCase(), college_id: collegeId, type: "invite" },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" },
    );

    // Non-blocking: email failure must not roll back provisioning
    sendInviteEmail(owner_email, inviteToken, college.slug).catch((err) => {
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
  dept_ids: string[],
  is_college_owner: boolean,
): Promise<void> {
  const conn = await getCollegeDb(college_id);
  const DeptAdmin = getDeptAdminModel(conn);
  const College = getCollegeModel();

  const existing = await DeptAdmin.findOne({ email: email.toLowerCase() }).lean();
  if (existing) {
    await DeptAdmin.updateOne(
      { email: email.toLowerCase() },
      { $addToSet: { dept_ids: { $each: dept_ids } } },
    );
    return;
  }

  const tempHash = await bcrypt.hash(randomUUID(), 12);
  await DeptAdmin.create({
    college_id,
    dept_ids,
    name: email.split("@")[0],
    email: email.toLowerCase(),
    password_hash: tempHash,
    role: "dept_admin",
    is_college_owner,
    status: "invited",
  });

  const collegeDoc = await College.findById(college_id).select("slug").lean();
  const inviteToken = jwt.sign(
    { email: email.toLowerCase(), college_id, type: "invite" },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" },
  );

  sendInviteEmail(email, inviteToken, collegeDoc?.slug ?? college_id).catch((err) => {
    console.error("[assignDeptAdmin] invite email failed:", err?.message);
  });
}
