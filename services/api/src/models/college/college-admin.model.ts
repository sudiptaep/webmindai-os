import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { CollegeAdmin, AdminStatus } from "@college-chatbot/shared";

const CollegeAdminSchema = new Schema<CollegeAdmin>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    password_hash: { type: String, default: "" },
    phone: { type: String },
    role: { type: String, default: "college_admin" },
    admin_title: {
      type: String,
      enum: ["Principal", "HOD", "Dean", "Registrar", "Academic Director", "Custom"],
      required: true,
    },
    custom_title: { type: String },
    permissions: {
      can_create_dept_admins: { type: Boolean, default: true },
      can_deactivate_dept_admins: { type: Boolean, default: true },
      can_view_student_list: { type: Boolean, default: true },
      can_export_reports: { type: Boolean, default: true },
      can_view_cost_usage: { type: Boolean, default: false },
    },
    status: { type: String, enum: ["active", "invited", "disabled"] as AdminStatus[], default: "invited" },
    invite_token: { type: String },
    invite_token_expires_at: { type: Date },
    invited_by: { type: String },
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

CollegeAdminSchema.index({ email: 1 }, { unique: true });
CollegeAdminSchema.index({ college_id: 1, status: 1 });
CollegeAdminSchema.index({ invite_token: 1 }, { sparse: true });

export function getCollegeAdminModel(conn: Connection): Model<CollegeAdmin> {
  return (
    (conn.models["CollegeAdmin"] as Model<CollegeAdmin>) ??
    conn.model<CollegeAdmin>("CollegeAdmin", CollegeAdminSchema)
  );
}
