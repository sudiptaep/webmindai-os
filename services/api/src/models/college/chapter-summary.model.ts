import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";

export interface ChapterSummaryDoc {
  _id: string;
  student_id: string;
  doc_id: string;
  college_id: string;
  chapter_index: number;
  mode: "brief" | "detailed" | "key-terms";
  content: string;
  tokens_used: number;
  generated_at: Date;
}

const ChapterSummarySchema = new Schema<ChapterSummaryDoc>(
  {
    _id:           { type: String, default: () => randomUUID() },
    student_id:    { type: String, required: true },
    doc_id:        { type: String, required: true },
    college_id:    { type: String, required: true },
    chapter_index: { type: Number, required: true },
    mode:          { type: String, enum: ["brief", "detailed", "key-terms"], required: true },
    content:       { type: String, required: true },
    tokens_used:   { type: Number, default: 0 },
    generated_at:  { type: Date,   default: () => new Date() },
  },
  { _id: false, versionKey: false },
);

ChapterSummarySchema.index(
  { student_id: 1, doc_id: 1, chapter_index: 1, mode: 1 },
  { unique: true },
);

export function getChapterSummaryModel(conn: Connection): Model<ChapterSummaryDoc> {
  return (
    (conn.models["ChapterSummary"] as Model<ChapterSummaryDoc>) ??
    conn.model<ChapterSummaryDoc>("ChapterSummary", ChapterSummarySchema)
  );
}
