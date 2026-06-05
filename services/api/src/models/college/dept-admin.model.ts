import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { DeptAdmin, AdminStatus } from "@college-chatbot/shared";

const DeptAdminSchema = new Schema<DeptAdmin>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    password_hash: { type: String, default: "" },
    phone: { type: String },
    role: { type: String, default: "dept_admin" },
    faculty_title: {
      type: String,
      enum: ["Professor", "Associate Prof", "Assistant Prof", "Lab In-Charge", "Coordinator"],
    },
    permissions: {
      can_upload_documents: { type: Boolean, default: true },
      can_delete_documents: { type: Boolean, default: true },
      can_manage_subjects: { type: Boolean, default: true },
      can_view_student_list: { type: Boolean, default: true },
      can_reset_student_passwords: { type: Boolean, default: false },
    },
    status: { type: String, enum: ["active", "invited", "disabled"] as AdminStatus[], default: "invited" },
    invite_token: { type: String },
    invite_token_expires_at: { type: Date },
    invited_by: { type: String },
    invited_by_role: { type: String, enum: ["super_admin", "college_admin"] },
    invite_accepted_at: { type: Date },
    last_login: { type: Date },
    last_login_ip: { type: String },
    login_count: { type: Number, default: 0 },
    password_reset_token: { type: String },
    password_reset_expires_at: { type: Date },
    must_change_password: { type: Boolean, default: false },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

DeptAdminSchema.index({ email: 1 }, { unique: true });
DeptAdminSchema.index({ college_id: 1, dept_id: 1, status: 1 });
DeptAdminSchema.index({ invite_token: 1 }, { sparse: true });

export function getDeptAdminModel(conn: Connection): Model<DeptAdmin> {
  return (conn.models["DeptAdmin"] as Model<DeptAdmin>) ?? conn.model<DeptAdmin>("DeptAdmin", DeptAdminSchema);
}
