import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { PYQQuestion, PYQQuestionType } from "@college-chatbot/shared";

const PYQQuestionSchema = new Schema<PYQQuestion>(
  {
    _id:                    { type: String, default: () => randomUUID() },
    pyq_paper_id:           { type: String, required: true },
    college_id:             { type: String, required: true },
    dept_id:                { type: String, required: true },
    subject_id:             { type: String, required: true },
    question_text:          { type: String, required: true },
    question_type:          {
      type: String,
      enum: ["MCQ", "SAQ", "LAQ", "CASE", "FIB"] as PYQQuestionType[],
      required: true,
    },
    marks:                  { type: Number, default: 0 },
    unit_number:            { type: String },
    section:                { type: String },
    year:                   { type: String, required: true },
    exam_name:              { type: String, required: true },
    mapped_chapter_indices: { type: [Number], default: [] },
    mapping_confidence:     { type: Number, default: 0.0 },
    pinecone_vector_id:     { type: String, required: true },
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

PYQQuestionSchema.index({ dept_id: 1, subject_id: 1, year: 1 });
PYQQuestionSchema.index({ mapped_chapter_indices: 1, dept_id: 1 });
PYQQuestionSchema.index({ pyq_paper_id: 1 });

export function getPYQQuestionModel(conn: Connection): Model<PYQQuestion> {
  return (
    (conn.models["PYQQuestion"] as Model<PYQQuestion>) ??
    conn.model<PYQQuestion>("PYQQuestion", PYQQuestionSchema)
  );
}
