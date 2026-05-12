import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { ExtractionJob, ExtractionJobStatus } from "@college-chatbot/shared";

const ExtractionJobSchema = new Schema<ExtractionJob>(
  {
    _id: { type: String, default: () => randomUUID() },
    student_id: { type: String, required: true },
    doc_id: { type: String, required: true },
    college_id: { type: String, required: true },
    job_type: {
      type: String,
      enum: ["extract_pages", "extract_slides"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "cleaned"] as ExtractionJobStatus[],
      default: "pending",
    },
    pages_requested: { type: [Number], required: true },
    output_file_path: { type: String },
    output_token: { type: String },
    error: { type: String },
    expires_at: { type: Date },
    completed_at: { type: Date },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: false }, versionKey: false },
);

ExtractionJobSchema.index({ student_id: 1, created_at: -1 });
ExtractionJobSchema.index({ status: 1, expires_at: 1 });

export function getExtractionJobModel(conn: Connection): Model<ExtractionJob> {
  return (
    (conn.models["ExtractionJob"] as Model<ExtractionJob>) ??
    conn.model<ExtractionJob>("ExtractionJob", ExtractionJobSchema)
  );
}
