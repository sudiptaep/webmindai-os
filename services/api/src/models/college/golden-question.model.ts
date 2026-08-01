import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { GoldenQuestion, GoldenQuestionDifficulty } from "@college-chatbot/shared";

const GoldenQuestionSchema = new Schema<GoldenQuestion>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    dept_id: { type: String, required: true },
    subject_id: { type: String },
    question_text: { type: String, required: true },
    expected_source_doc_id: { type: String },
    expected_source_page: { type: Number },
    expected_answer_summary: { type: String },
    difficulty: {
      type: String,
      enum: ["recall", "application", "analysis"] as GoldenQuestionDifficulty[],
      default: "recall",
    },
    added_by: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: false }, versionKey: false },
);

GoldenQuestionSchema.index({ dept_id: 1, subject_id: 1, active: 1 });

export function getGoldenQuestionModel(conn: Connection): Model<GoldenQuestion> {
  return (
    (conn.models["GoldenQuestion"] as Model<GoldenQuestion>) ??
    conn.model<GoldenQuestion>("GoldenQuestion", GoldenQuestionSchema)
  );
}
