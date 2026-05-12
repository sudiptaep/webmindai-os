import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { DownloadLog, LibraryAction } from "@college-chatbot/shared";

const DownloadLogSchema = new Schema<DownloadLog>(
  {
    _id: { type: String, default: () => randomUUID() },
    student_id: { type: String, required: true },
    doc_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    college_id: { type: String, required: true },
    action: {
      type: String,
      enum: ["download", "extract_text", "extract_pages", "ai_summary", "stream", "preview"] as LibraryAction[],
      required: true,
    },
    ip_address: { type: String },
    user_agent: { type: String },
    pages_extracted: { type: [Number] },
    tokens_used: { type: Number },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: false }, versionKey: false },
);

DownloadLogSchema.index({ student_id: 1, created_at: -1 });
DownloadLogSchema.index({ doc_id: 1, action: 1 });
DownloadLogSchema.index({ college_id: 1, dept_id: 1, created_at: -1 });

export function getDownloadLogModel(conn: Connection): Model<DownloadLog> {
  return (
    (conn.models["DownloadLog"] as Model<DownloadLog>) ??
    conn.model<DownloadLog>("DownloadLog", DownloadLogSchema)
  );
}
