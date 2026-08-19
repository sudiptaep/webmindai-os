import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { Misconception, MisconceptionSource } from "@college-chatbot/shared";

const MisconceptionSchema = new Schema<Misconception>(
  {
    _id:                   { type: String, default: () => randomUUID() },
    concept_id:            { type: String, required: true },
    college_id:            { type: String, required: true },
    dept_id:               { type: String, required: true },

    statement:             { type: String, required: true },
    correct_model:         { type: String, required: true },
    root_cause:            { type: String, default: "" },
    diagnostic_probe:      { type: String, required: true },
    probe_correct_answer:  { type: String, required: true },
    probe_wrong_answer:    { type: String, required: true },

    source: {
      type: String,
      enum: ["llm_seeded", "observed_from_students", "seeded_and_observed", "faculty_authored"] as MisconceptionSource[],
      default: "llm_seeded",
    },
    observed_count:        { type: Number, default: 0 },
    first_observed:        { type: Date, default: () => new Date() },
    last_observed:         { type: Date, default: () => new Date() },

    times_probed:          { type: Number, default: 0 },
    times_corrected:       { type: Number, default: 0 },
    correction_success_rate: { type: Number, default: null },

    reviewed_by_faculty:   { type: Boolean, default: false },
    priority_rank:         { type: Number, default: 0 },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

MisconceptionSchema.index({ concept_id: 1, priority_rank: 1 });
MisconceptionSchema.index({ dept_id: 1, observed_count: -1 });
MisconceptionSchema.index({ dept_id: 1, correction_success_rate: 1 });

export function getMisconceptionModel(conn: Connection): Model<Misconception> {
  return (
    (conn.models["Misconception"] as Model<Misconception>) ??
    conn.model<Misconception>("Misconception", MisconceptionSchema, "misconceptions")
  );
}
