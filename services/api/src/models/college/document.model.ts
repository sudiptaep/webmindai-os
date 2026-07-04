import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { Document as ChatDocument, FileType, IngestionStatus } from "@college-chatbot/shared";

const DocumentSchema = new Schema<ChatDocument>(
  {
    _id: { type: String, default: () => randomUUID() },
    dept_id: { type: String, required: true },
    subject_id: { type: String },
    college_id: { type: String, required: true },
    original_filename: { type: String, required: true },
    file_type: {
      type: String,
      enum: ["pdf", "pptx", "mp4", "mkv", "mp3", "m4a", "docx"] as FileType[],
      required: true,
    },
    r2_key: { type: String, required: true },
    file_path: { type: String },
    file_size_bytes: { type: Number, required: true },
    ingestion_status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"] as IngestionStatus[],
      default: "pending",
    },
    ingestion_error: { type: String },
    chunk_count: { type: Number, default: 0 },
    ocr_used: { type: Boolean, default: false },
    quality_score: { type: Number, default: 0 },
    page_count: { type: Number },
    slide_count: { type: Number },
    duration_seconds: { type: Number },
    download_enabled: { type: Boolean, default: true },
    is_visible_to_students: { type: Boolean, default: true },
    thumbnail_path: { type: String },
    text_cache_path: { type: String },
    transcript_path: { type: String },
    uploaded_by: { type: String, required: true },
    academic_year: { type: String, required: true },
    version: { type: Number, default: 1 },
    has_chapter_map: { type: Boolean, default: false },
    chapter_count: { type: Number },
    image_count_raw: { type: Number },
    image_count_analysed: { type: Number },
    image_count_indexed: { type: Number },
    image_ingestion_status: {
      type: String,
      enum: ["not_started", "queued", "processing", "completed", "partial", "failed"],
      default: "not_started",
    },
    image_ingestion_cost_usd: { type: Number },
    images_enabled: { type: Boolean, default: true },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

DocumentSchema.index({ dept_id: 1, ingestion_status: 1 });
DocumentSchema.index({ dept_id: 1, is_visible_to_students: 1, ingestion_status: 1 });
DocumentSchema.index({ dept_id: 1, subject_id: 1, file_type: 1 });

export function getDocumentModel(conn: Connection): Model<ChatDocument> {
  return (
    (conn.models["Document"] as Model<ChatDocument>) ?? conn.model<ChatDocument>("Document", DocumentSchema)
  );
}
