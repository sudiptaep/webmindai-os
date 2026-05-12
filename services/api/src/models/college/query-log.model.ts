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
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

QueryLogSchema.index({ college_id: 1, dept_id: 1, created_at: -1 });
QueryLogSchema.index({ answered: 1, flagged_to_admin: 1 });

export function getQueryLogModel(conn: Connection): Model<QueryLog> {
  return (conn.models["QueryLog"] as Model<QueryLog>) ?? conn.model<QueryLog>("QueryLog", QueryLogSchema);
}
