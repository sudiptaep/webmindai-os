import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { ChapterMap, Chapter, ExtractionMethod } from "@college-chatbot/shared";

const ChapterSchema = new Schema<Chapter>(
  {
    chapter_index:       { type: Number, required: true },
    title:               { type: String, required: true },
    subtitle:            { type: String },
    start_page:          { type: Number, required: true },
    end_page:            { type: Number, required: true },
    page_count:          { type: Number, required: true },
    chunk_ids:           { type: [String], default: [] },
    chunk_count:         { type: Number, default: 0 },
    pyq_count:           { type: Number, default: 0 },
    pyq_years:           { type: [String], default: [] },
    pyq_question_ids:    { type: [String], default: [] },
    pyq_coverage_score:  { type: Number, default: 0.0 },
    avg_class_score:     { type: Number },
    study_session_count: { type: Number, default: 0 },
  },
  { _id: false },
);

const ChapterMapSchema = new Schema<ChapterMap>(
  {
    _id:               { type: String, default: () => randomUUID() },
    doc_id:            { type: String, required: true },
    college_id:        { type: String, required: true },
    dept_id:           { type: String, required: true },
    extraction_method: {
      type: String,
      enum: ["pdf_bookmarks", "heuristic", "manual"] as ExtractionMethod[],
      required: true,
    },
    confidence_score:  { type: Number, required: true },
    total_chapters:    { type: Number, required: true },
    total_pages:       { type: Number, required: true },
    chapters:          { type: [ChapterSchema], default: [] },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

ChapterMapSchema.index({ doc_id: 1 }, { unique: true });
ChapterMapSchema.index({ college_id: 1, dept_id: 1 });

export function getChapterMapModel(conn: Connection): Model<ChapterMap> {
  return (
    (conn.models["ChapterMap"] as Model<ChapterMap>) ??
    conn.model<ChapterMap>("ChapterMap", ChapterMapSchema)
  );
}
