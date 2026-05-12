import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { Subject } from "@college-chatbot/shared";

const SubjectSchema = new Schema<Subject>(
  {
    _id: { type: String, default: () => randomUUID() },
    dept_id: { type: String, required: true },
    college_id: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    semester: { type: Number, required: true },
    year: { type: Number, required: true },
    doc_count: { type: Number, default: 0 },
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

SubjectSchema.index({ dept_id: 1, code: 1 }, { unique: true });

export function getSubjectModel(conn: Connection): Model<Subject> {
  return (conn.models["Subject"] as Model<Subject>) ?? conn.model<Subject>("Subject", SubjectSchema);
}
