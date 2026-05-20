import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { ClinicalCase, CaseQuestionType, CaseDifficulty } from "@college-chatbot/shared";

const ClinicalCaseSchema = new Schema<ClinicalCase>(
  {
    _id:            { type: String, default: () => randomUUID() },
    college_id:     { type: String, required: true },
    dept_id:        { type: String, required: true },
    doc_id:         { type: String, required: true },
    chapter_index:  { type: Number, required: true },
    subject_id:     { type: String, required: true },

    case_text:               { type: String, required: true },
    question:                { type: String, required: true },
    question_type: {
      type: String,
      enum: ["diagnosis", "management", "investigation", "mechanism", "complication"] as CaseQuestionType[],
      required: true,
    },
    difficulty: {
      type: String,
      enum: ["recall", "application", "analysis"] as CaseDifficulty[],
      required: true,
    },
    options:                 { type: [String], default: [] },
    correct_answer:          { type: String, required: true },
    expected_answer:         { type: String, required: true },
    key_teaching_points:     { type: [String], default: [] },
    source_pages:            { type: [Number], default: [] },
    bloom_level:             { type: String, default: "apply" },

    generated_from_chunk_ids: { type: [String], default: [] },
    cache_version:            { type: Number, default: 1 },
    times_served:             { type: Number, default: 0 },

    expires_at: { type: Date },
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

ClinicalCaseSchema.index({ doc_id: 1, chapter_index: 1, question_type: 1, difficulty: 1 });
ClinicalCaseSchema.index({ dept_id: 1, subject_id: 1, question_type: 1 });
// partial TTL — only expire docs where expires_at is set (non-null)
ClinicalCaseSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expires_at: { $exists: true } } });

export function getClinicalCaseModel(conn: Connection): Model<ClinicalCase> {
  return (
    (conn.models["ClinicalCase"] as Model<ClinicalCase>) ??
    conn.model<ClinicalCase>("ClinicalCase", ClinicalCaseSchema)
  );
}
