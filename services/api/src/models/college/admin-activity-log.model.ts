import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { AdminActivityLog } from "@college-chatbot/shared";

const AdminActivityLogSchema = new Schema<AdminActivityLog>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    actor_id: { type: String, required: true },
    actor_role: { type: String, enum: ["super_admin", "college_admin", "dept_admin"], required: true },
    actor_name: { type: String, required: true },
    action: {
      type: String,
      enum: [
        "create_college_admin",
        "create_dept_admin",
        "deactivate_college_admin",
        "deactivate_dept_admin",
        "reactivate_college_admin",
        "reactivate_dept_admin",
        "reset_admin_password",
        "upload_document",
        "delete_document",
        "reingest_document",
        "create_subject",
        "delete_subject",
        "create_department",
        "disable_student",
        "reset_student_password",
        "update_college_admin_permissions",
        "update_dept_admin_permissions",
        "impersonate_admin",
      ],
      required: true,
    },
    target_type: {
      type: String,
      enum: ["college_admin", "dept_admin", "student", "document", "subject", "department"],
      required: true,
    },
    target_id: { type: String, required: true },
    target_name: { type: String, required: true },
    dept_id: { type: String },
    dept_name: { type: String },
    metadata: { type: Schema.Types.Mixed },
    ip_address: { type: String },
    user_agent: { type: String },
    created_at: { type: Date, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);

AdminActivityLogSchema.index({ college_id: 1, created_at: -1 });
AdminActivityLogSchema.index({ actor_id: 1, created_at: -1 });
AdminActivityLogSchema.index({ action: 1, created_at: -1 });

export function getAdminActivityLogModel(conn: Connection): Model<AdminActivityLog> {
  return (
    (conn.models["AdminActivityLog"] as Model<AdminActivityLog>) ??
    conn.model<AdminActivityLog>("AdminActivityLog", AdminActivityLogSchema)
  );
}
