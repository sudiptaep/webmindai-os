import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { Department, DepartmentType } from "@college-chatbot/shared";

const DepartmentSchema = new Schema<Department>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    type: {
      type: String,
      enum: ["engineering", "medical", "generic", "other"] as DepartmentType[],
      required: true,
    },
    is_generic: { type: Boolean, default: false },
    cannot_delete: { type: Boolean, default: false },
    pinecone_namespace: { type: String, required: true },
    subject_count: { type: Number, default: 0 },
    doc_count: { type: Number, default: 0 },
    chunk_count: { type: Number, default: 0 },
    deleted: { type: Boolean, default: false },
    // F-19-E: per-department rerank-score threshold calibration
    rerank_answer_threshold: { type: Number },
    rerank_confident_threshold: { type: Number },
    threshold_calibrated_at: { type: Date },
    threshold_calibration_sample_size: { type: Number },
    // F-19-F: true hybrid search
    bm25_encoder_path: { type: String },
    bm25_fitted_at: { type: Date },
    bm25_corpus_size: { type: Number },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

DepartmentSchema.index({ college_id: 1, code: 1 }, { unique: true });

export function getDepartmentModel(conn: Connection): Model<Department> {
  return (conn.models["Department"] as Model<Department>) ?? conn.model<Department>("Department", DepartmentSchema);
}
