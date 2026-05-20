import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { PYQPaper, IngestionStatus } from "@college-chatbot/shared";

const PYQPaperSchema = new Schema<PYQPaper>(
  {
    _id:               { type: String, default: () => randomUUID() },
    college_id:        { type: String, required: true },
    dept_id:           { type: String, required: true },
    subject_id:        { type: String, required: true },
    year:              { type: String, required: true },
    month:             { type: String },
    exam_name:         { type: String, required: true },
    university:        { type: String },
    doc_id:            { type: String, required: true },
    file_path:         { type: String, required: true },
    ingestion_status:  {
      type: String,
      enum: ["pending", "processing", "completed", "failed"] as IngestionStatus[],
      default: "pending",
    },
    question_count:    { type: Number, default: 0 },
    pinecone_namespace: { type: String, required: true },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

PYQPaperSchema.index({ college_id: 1, dept_id: 1, subject_id: 1 });
PYQPaperSchema.index({ college_id: 1, dept_id: 1, year: 1 });

export function getPYQPaperModel(conn: Connection): Model<PYQPaper> {
  return (
    (conn.models["PYQPaper"] as Model<PYQPaper>) ??
    conn.model<PYQPaper>("PYQPaper", PYQPaperSchema)
  );
}
