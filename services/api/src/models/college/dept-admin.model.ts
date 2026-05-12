import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { DeptAdmin, AdminStatus } from "@college-chatbot/shared";

const DeptAdminSchema = new Schema<DeptAdmin>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    dept_ids: { type: [String], default: [] },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    password_hash: { type: String, default: "" },
    role: { type: String, default: "dept_admin" },
    is_college_owner: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "invited", "disabled"] as AdminStatus[], default: "invited" },
    last_login: { type: Date },
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

DeptAdminSchema.index({ email: 1 }, { unique: true });

export function getDeptAdminModel(conn: Connection): Model<DeptAdmin> {
  return (conn.models["DeptAdmin"] as Model<DeptAdmin>) ?? conn.model<DeptAdmin>("DeptAdmin", DeptAdminSchema);
}
