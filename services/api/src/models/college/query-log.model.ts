import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { QueryLog } from "@college-chatbot/shared";

const QueryLogSchema = new Schema<QueryLog>(
  {
    _id: { type: String, default: () => randomUUID() },
    student_id: { type: String, required: true },
    session_id: { type: String, required: true },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    query_text: { type: String, required: true },
    answered: { type: Boolean, default: false },
    confidence_score: { type: Number, default: 0 },
    sources_used: { type: [String], default: [] },
    flagged_to_admin: { type: Boolean, default: false },
    response_time_ms: { type: Number, default: 0 },
    tokens_used: { type: Number, default: 0 },
    // F-18-B: retrieval telemetry
    retrieved_chunk_ids: { type: [String], default: undefined },
    cited_chunk_ids: { type: [String], default: undefined },
    retrieval_precision: { type: Number },
    query_complexity: { type: String, enum: ["simple", "multi_part", "case_based"] },
    top_k_used: { type: Number },
    mmr_applied: { type: Boolean },
    query_rewritten_text: { type: String },
    // F-19-C: conversational query rewriting
    rewrite_applied: { type: Boolean },
    resolved_entities: { type: [String], default: undefined },
    // F-19-D: metadata pre-filtering
    retrieval_tier: { type: Number },
    // F-19-E: rerank-score three-band threshold gate
    answer_confidence_band: { type: String, enum: ["confident", "hedged", "refused"] },
    // F-18-C: rerank monitoring
    rerank_top_score: { type: Number },
    rerank_score_spread: { type: Number },
    rerank_candidate_count: { type: Number },
    // F-18-D: truncation telemetry
    stop_reason: { type: String },
    was_truncated: { type: Boolean },
    was_truncated_and_continued: { type: Boolean },
    // F-19-B: small-to-big expansion telemetry
    child_chunks_retrieved: { type: Number },
    parent_chunks_used: { type: Number },
    parent_expansion_ratio: { type: Number },
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

QueryLogSchema.index({ college_id: 1, dept_id: 1, created_at: -1 });
QueryLogSchema.index({ answered: 1, flagged_to_admin: 1 });

export function getQueryLogModel(conn: Connection): Model<QueryLog> {
  return (conn.models["QueryLog"] as Model<QueryLog>) ?? conn.model<QueryLog>("QueryLog", QueryLogSchema);
}
