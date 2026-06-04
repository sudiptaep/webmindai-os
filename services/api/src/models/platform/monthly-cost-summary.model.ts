import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";

export interface MonthlyCostSummary {
  _id: string;
  billing_month: string;    // "2026-05"
  college_id: string;
  dept_id: string;          // "ALL" for college-level rollup

  anthropic_cost_usd: number;
  openai_cost_usd: number;
  cohere_cost_usd: number;
  pinecone_cost_usd: number;
  total_cost_usd: number;

  llm_input_tokens: number;
  llm_output_tokens: number;
  embedding_tokens: number;
  rerank_calls: number;
  pinecone_write_units: number;
  pinecone_read_units: number;

  chat_message_count: number;
  ai_summary_count: number;
  exam_gen_count: number;
  doc_ingestion_count: number;
  unique_students: number;

  storage_used_gb: number;

  llm_token_limit: number;
  token_utilisation_pct: number;
  cost_budget_usd: number;
  cost_utilisation_pct: number;

  computed_at: Date;
}

const MonthlyCostSummarySchema = new Schema<MonthlyCostSummary>(
  {
    _id: { type: String, default: () => randomUUID() },
    billing_month: { type: String, required: true },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },

    anthropic_cost_usd: { type: Number, default: 0 },
    openai_cost_usd: { type: Number, default: 0 },
    cohere_cost_usd: { type: Number, default: 0 },
    pinecone_cost_usd: { type: Number, default: 0 },
    total_cost_usd: { type: Number, default: 0 },

    llm_input_tokens: { type: Number, default: 0 },
    llm_output_tokens: { type: Number, default: 0 },
    embedding_tokens: { type: Number, default: 0 },
    rerank_calls: { type: Number, default: 0 },
    pinecone_write_units: { type: Number, default: 0 },
    pinecone_read_units: { type: Number, default: 0 },

    chat_message_count: { type: Number, default: 0 },
    ai_summary_count: { type: Number, default: 0 },
    exam_gen_count: { type: Number, default: 0 },
    doc_ingestion_count: { type: Number, default: 0 },
    unique_students: { type: Number, default: 0 },

    storage_used_gb: { type: Number, default: 0 },

    llm_token_limit: { type: Number, default: 0 },
    token_utilisation_pct: { type: Number, default: 0 },
    cost_budget_usd: { type: Number, default: 0 },
    cost_utilisation_pct: { type: Number, default: 0 },

    computed_at: { type: Date, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);

MonthlyCostSummarySchema.index({ billing_month: 1, college_id: 1, dept_id: 1 }, { unique: true });
MonthlyCostSummarySchema.index({ college_id: 1, billing_month: 1 });

export function getMonthlyCostSummaryModel(): Model<MonthlyCostSummary> {
  return (
    (mongoose.models["MonthlyCostSummary"] as Model<MonthlyCostSummary>) ??
    mongoose.model<MonthlyCostSummary>("MonthlyCostSummary", MonthlyCostSummarySchema)
  );
}
