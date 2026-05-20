import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { DiseaseQuery, DiseaseSubjectResult, DiseaseChunkResult } from "@college-chatbot/shared";

const DiseaseChunkResultSchema = new Schema<DiseaseChunkResult>(
  {
    chunk_id:        { type: String, required: true },
    text:            { type: String, required: true },
    page_num:        { type: Number, required: true },
    chapter_title:   { type: String, default: "" },
    relevance_score: { type: Number, required: true },
  },
  { _id: false },
);

const DiseaseSubjectResultSchema = new Schema<DiseaseSubjectResult>(
  {
    subject_id:       { type: String, required: true },
    subject_name:     { type: String, required: true },
    doc_id:           { type: String, required: true },
    doc_filename:     { type: String, required: true },
    relevant_chunks:  { type: [DiseaseChunkResultSchema], default: [] },
    summary:          { type: String, default: "" },
  },
  { _id: false },
);

const DiseaseQuerySchema = new Schema<DiseaseQuery>(
  {
    _id:             { type: String, default: () => randomUUID() },
    college_id:      { type: String, required: true },
    dept_id_scope:   { type: String, default: "all" },
    disease_name:    { type: String, required: true },
    disease_aliases: { type: [String], default: [] },

    subject_results:   { type: [DiseaseSubjectResultSchema], default: [] },
    compiled_answer:   { type: String, default: "" },
    cross_connections: { type: [String], default: [] },

    cache_key:  { type: String, required: true },
    expires_at: { type: Date, required: true },
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

DiseaseQuerySchema.index({ college_id: 1, disease_name: 1 });
DiseaseQuerySchema.index({ cache_key: 1 }, { unique: true });
DiseaseQuerySchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export function getDiseaseQueryModel(conn: Connection): Model<DiseaseQuery> {
  return (
    (conn.models["DiseaseQuery"] as Model<DiseaseQuery>) ??
    conn.model<DiseaseQuery>("DiseaseQuery", DiseaseQuerySchema)
  );
}
