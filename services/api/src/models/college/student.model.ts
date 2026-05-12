import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { Student, StudentStatus } from "@college-chatbot/shared";

const StudentSchema = new Schema<Student>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    effective_dept_id: { type: String, required: true },
    using_generic_fallback: { type: Boolean, default: false },
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    password_hash: { type: String, required: true },
    roll_number: { type: String },
    semester: { type: Number, required: true },
    status: { type: String, enum: ["active", "disabled", "pending_approval"] as StudentStatus[], default: "pending_approval" },
    email_verified: { type: Boolean, default: false },
    last_login: { type: Date },
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

StudentSchema.index({ email: 1 }, { unique: true });
StudentSchema.index({ dept_id: 1 });
StudentSchema.index({ using_generic_fallback: 1 });

export function getStudentModel(conn: Connection): Model<Student> {
  return (conn.models["Student"] as Model<Student>) ?? conn.model<Student>("Student", StudentSchema);
}
