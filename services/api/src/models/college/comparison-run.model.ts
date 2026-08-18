import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { ComparisonRun, ComparisonFailureSignature, ComparisonHumanVerdict } from "@college-chatbot/shared";

const ComparisonRunSourceSchema = new Schema(
  {
    doc_id: { type: String, required: true },
    page: { type: Number },
    chunk_text: { type: String, required: true },
  },
  { _id: false },
);

const ComparisonRunSchema = new Schema<ComparisonRun>(
  {
    _id: { type: String, default: () => randomUUID() },
    golden_question_id: { type: String },
    question_text: { type: String, required: true },
    dept_id: { type: String, required: true },
    college_id: { type: String, required: true },
    eval_batch_label: { type: String },
    retrieval_hit: { type: Boolean },

    grounded_response_text: { type: String, default: "" },
    grounded_sources: { type: [ComparisonRunSourceSchema], default: [] },
    grounded_retrieval_score: { type: Number, default: 0 },
    grounded_latency_ms: { type: Number, default: 0 },
    grounded_tokens_used: { type: Number, default: 0 },

    frontier_model: { type: String, required: true },
    frontier_response_text: { type: String, default: "" },
    frontier_latency_ms: { type: Number, default: 0 },
    frontier_tokens_used: { type: Number, default: 0 },

    faithfulness_score: { type: Number, default: 0 },
    completeness_score: { type: Number, default: 0 },
    citation_accuracy: { type: Boolean, default: false },
    judge_reasoning: { type: String, default: "" },

    human_verdict: { type: String, enum: ["grounded_better", "frontier_better", "equivalent", "both_wrong"] as ComparisonHumanVerdict[] },
    human_notes: { type: String },
    reviewed_by: { type: String },
    reviewed_at: { type: Date },

    failure_signature: {
      type: String,
      enum: ["none", "extraction_failure", "retrieval_failure", "expected_divergence"] as ComparisonFailureSignature[],
      default: "none",
    },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: false }, versionKey: false },
);

ComparisonRunSchema.index({ dept_id: 1, created_at: -1 });
ComparisonRunSchema.index({ golden_question_id: 1, created_at: -1 });
ComparisonRunSchema.index({ failure_signature: 1 });
ComparisonRunSchema.index({ dept_id: 1, eval_batch_label: 1 });

export function getComparisonRunModel(conn: Connection): Model<ComparisonRun> {
  return (
    (conn.models["ComparisonRun"] as Model<ComparisonRun>) ??
    conn.model<ComparisonRun>("ComparisonRun", ComparisonRunSchema)
  );
}
