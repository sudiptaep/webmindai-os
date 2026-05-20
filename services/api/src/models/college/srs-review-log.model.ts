import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { SrsReviewLog } from "@college-chatbot/shared";

const SrsReviewLogSchema = new Schema<SrsReviewLog>(
  {
    _id:               { type: String, default: () => randomUUID() },
    srs_card_id:       { type: String, required: true },
    student_id:        { type: String, required: true },
    college_id:        { type: String, required: true },

    quality:           { type: Number, required: true, min: 0, max: 5 },
    student_answer:    { type: String, default: "" },
    was_correct:       { type: Boolean, required: true },
    time_taken_seconds:{ type: Number, default: 0 },

    interval_before:   { type: Number, required: true },
    ease_before:       { type: Number, required: true },
    interval_after:    { type: Number, required: true },
    ease_after:        { type: Number, required: true },
    next_review_at:    { type: Date, required: true },

    reviewed_at:       { type: Date, default: () => new Date() },
  },
  { _id: false, versionKey: false },
);

SrsReviewLogSchema.index({ student_id: 1, reviewed_at: -1 });
SrsReviewLogSchema.index({ srs_card_id: 1, reviewed_at: -1 });

export function getSrsReviewLogModel(conn: Connection): Model<SrsReviewLog> {
  return (
    (conn.models["SrsReviewLog"] as Model<SrsReviewLog>) ??
    conn.model<SrsReviewLog>("SrsReviewLog", SrsReviewLogSchema)
  );
}
