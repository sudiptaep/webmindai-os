import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";

export type CostEventActionType =
  | "chat_message"
  | "ai_summary"
  | "exam_generation"
  | "doc_ingestion"
  | "query_embedding"
  | "rerank"
  | "pinecone_write"
  | "pinecone_read"
  | "image_ingestion";

export type CostEventService = "anthropic" | "openai_embeddings" | "cohere" | "pinecone" | "openai_vision";

export interface CostEvent {
  _id: string;
  college_id: string;
  dept_id: string;
  student_id?: string;
  session_id?: string;
  action_type: CostEventActionType;
  service: CostEventService;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  embedding_tokens?: number;
  rerank_units?: number;
  vector_write_units?: number;
  vector_read_units?: number;
  cost_usd: number;
  billing_month: string;   // "2026-05"
  billing_day: string;     // "2026-05-20"
  created_at: Date;
}

const CostEventSchema = new Schema<CostEvent>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    student_id: { type: String },
    session_id: { type: String },
    action_type: {
      type: String,
      enum: ["chat_message","ai_summary","exam_generation","doc_ingestion","query_embedding","rerank","pinecone_write","pinecone_read","image_ingestion"],
      required: true,
    },
    service: { type: String, enum: ["anthropic","openai_embeddings","cohere","pinecone","openai_vision"], required: true },
    model: { type: String },
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    embedding_tokens: { type: Number, default: 0 },
    rerank_units: { type: Number, default: 0 },
    vector_write_units: { type: Number, default: 0 },
    vector_read_units: { type: Number, default: 0 },
    cost_usd: { type: Number, required: true },
    billing_month: { type: String, required: true },
    billing_day: { type: String, required: true },
  },
  { _id: false, timestamps: false, versionKey: false },
);

// Spec §3.2 indexes
CostEventSchema.index({ college_id: 1, billing_month: 1, service: 1 });
CostEventSchema.index({ college_id: 1, dept_id: 1, billing_month: 1 });
CostEventSchema.index({ college_id: 1, billing_day: 1 });
CostEventSchema.index({ action_type: 1, billing_month: 1 });
CostEventSchema.index({ college_id: 1, billing_month: 1, action_type: 1 });

// created_at stored as doc default
CostEventSchema.add({ created_at: { type: Date, default: () => new Date() } });

export function getCostEventModel(): Model<CostEvent> {
  return (
    (mongoose.models["CostEvent"] as Model<CostEvent>) ??
    mongoose.model<CostEvent>("CostEvent", CostEventSchema)
  );
}
