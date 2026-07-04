import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { QuizSession, QuizQuestion, QuizMode, QuizQuestionType, QuizDifficulty } from "@college-chatbot/shared";

const QuizQuestionSchema = new Schema<QuizQuestion>(
  {
    question_id:        { type: String, default: () => randomUUID() },
    question_text:      { type: String, required: true },
    question_type:      { type: String, required: true },
    options:            { type: [String], default: [] },
    correct_answer:     { type: String, default: "" },
    explanation:        { type: String, default: "" },
    source_page:        { type: Number },
    bloom_level:        { type: String, default: "remember" },
    difficulty:         { type: String, required: true },
    is_pyq:             { type: Boolean, default: false },
    pyq_question_id:    { type: String },
    pyq_year:           { type: String },
    image_asset_id:     { type: String },
    student_answer:     { type: String },
    is_correct:         { type: Boolean },
    time_taken_seconds: { type: Number },
    answered_at:        { type: Date },
  },
  { _id: false },
);

const QuizSessionSchema = new Schema<QuizSession>(
  {
    _id:                   { type: String, default: () => randomUUID() },
    student_id:            { type: String, required: true },
    doc_id:                { type: String, required: true },
    chapter_index:         { type: Number },
    subject_id:            { type: String, required: true },
    college_id:            { type: String, required: true },
    dept_id:               { type: String, required: true },
    quiz_mode:             {
      type: String,
      enum: ["practice", "test", "timed", "pyq_sim", "weak_spots", "socratic"] as QuizMode[],
      required: true,
    },
    question_type:         {
      type: String,
      enum: ["MCQ", "TF", "SAQ", "CASE", "MIXED", "PYQ", "IMAGE_LABEL"] as QuizQuestionType[],
      required: true,
    },
    difficulty:            {
      type: String,
      enum: ["recall", "application", "analysis", "adaptive"] as QuizDifficulty[],
      required: true,
    },
    time_limit_seconds:    { type: Number },
    questions:             { type: [QuizQuestionSchema], default: [] },
    status:                {
      type: String,
      enum: ["in_progress", "completed", "abandoned"],
      default: "in_progress",
    },
    score_pct:             { type: Number },
    correct_count:         { type: Number },
    total_count:           { type: Number, required: true },
    time_taken_seconds:    { type: Number },
    weak_topics:           { type: [String], default: [] },
    strong_topics:         { type: [String], default: [] },
    pyq_coverage_pct:      { type: Number },
    pyq_would_pass_count:  { type: Number },
    recommendation:        { type: String },
    started_at:            { type: Date, default: () => new Date() },
    completed_at:          { type: Date },
  },
  { _id: false, versionKey: false },
);

QuizSessionSchema.index({ student_id: 1, doc_id: 1, completed_at: -1 });
QuizSessionSchema.index({ student_id: 1, chapter_index: 1, completed_at: -1 });
QuizSessionSchema.index({ college_id: 1, dept_id: 1, completed_at: -1 });

export function getQuizSessionModel(conn: Connection): Model<QuizSession> {
  return (
    (conn.models["QuizSession"] as Model<QuizSession>) ??
    conn.model<QuizSession>("QuizSession", QuizSessionSchema)
  );
}
