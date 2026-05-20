import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { SrsCard, SrsCardStatus, QuizQuestionType } from "@college-chatbot/shared";

const SrsCardSchema = new Schema<SrsCard>(
  {
    _id:               { type: String, default: () => randomUUID() },
    student_id:        { type: String, required: true },
    college_id:        { type: String, required: true },
    dept_id:           { type: String, required: true },
    doc_id:            { type: String, required: true },
    chapter_index:     { type: Number, required: true },
    subject_id:        { type: String, required: true },

    question_text:     { type: String, required: true },
    question_type:     {
      type: String,
      enum: ["MCQ", "TF", "SAQ", "CASE", "MIXED", "PYQ"] as QuizQuestionType[],
      required: true,
    },
    options:           { type: [String], default: [] },
    correct_answer:    { type: String, required: true },
    explanation:       { type: String, default: "" },
    source_page:       { type: Number },
    bloom_level:       { type: String, default: "understand" },

    // SM-2 state
    ease_factor:       { type: Number, default: 2.5 },
    interval_days:     { type: Number, default: 1 },
    repetition_count:  { type: Number, default: 0 },
    last_quality:      { type: Number, default: 5 },

    next_review_at:    { type: Date, required: true },
    first_seen_at:     { type: Date, default: () => new Date() },
    last_reviewed_at:  { type: Date, default: () => new Date() },

    status: {
      type: String,
      enum: ["active", "suspended", "graduated"] as SrsCardStatus[],
      default: "active",
    },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

// "due today" query — most used
SrsCardSchema.index({ student_id: 1, status: 1, next_review_at: 1 });
// chapter-scoped lookup (dedupe on quiz completion)
SrsCardSchema.index({ student_id: 1, doc_id: 1, chapter_index: 1 });
// admin analytics
SrsCardSchema.index({ college_id: 1, dept_id: 1, next_review_at: 1 });

export function getSrsCardModel(conn: Connection): Model<SrsCard> {
  return (
    (conn.models["SrsCard"] as Model<SrsCard>) ??
    conn.model<SrsCard>("SrsCard", SrsCardSchema)
  );
}
