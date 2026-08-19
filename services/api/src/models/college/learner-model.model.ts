import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type { LearnerModel, HeldMisconception } from "@college-chatbot/shared";

const HeldMisconceptionSchema = new Schema<HeldMisconception>(
  {
    misconception_id: { type: String, required: true },
    concept_id:        { type: String, required: true },
    first_observed:    { type: Date, required: true },
    last_observed:     { type: Date, required: true },
    times_observed:    { type: Number, default: 1 },
    corrected:         { type: Boolean, default: false },
    corrected_at:      { type: Date },
  },
  { _id: false },
);

const LearnerModelSchema = new Schema<LearnerModel>(
  {
    _id:         { type: String, default: () => randomUUID() },
    student_id:  { type: String, required: true },
    college_id:  { type: String, required: true },
    dept_id:     { type: String, required: true },

    // Keyed by dynamic id/strategy name — plain Mixed objects rather than
    // Mongoose Maps, since there is no other precedent for Map fields in this
    // codebase and Mixed round-trips as plain JS objects through .lean() with
    // no extra (de)serialization step.
    concept_mastery:     { type: Schema.Types.Mixed, default: {} },
    held_misconceptions: { type: [HeldMisconceptionSchema], default: [] },

    strategy_success_rates: { type: Schema.Types.Mixed, default: {} },
    strategy_sample_counts: { type: Schema.Types.Mixed, default: {} },

    avg_checks_to_mastery:            { type: Number, default: 0 },
    avg_session_duration_minutes:     { type: Number, default: 0 },
    preferred_difficulty_entry_level: { type: Number, default: 2 },

    total_teaching_sessions:     { type: Number, default: 0 },
    total_concepts_taught:       { type: Number, default: 0 },
    total_backtracks_triggered:  { type: Number, default: 0 },
  },
  { _id: false, timestamps: { createdAt: false, updatedAt: "updated_at" }, versionKey: false },
);

LearnerModelSchema.index({ student_id: 1 }, { unique: true });
LearnerModelSchema.index({ dept_id: 1 });

export function getLearnerModelModel(conn: Connection): Model<LearnerModel> {
  return (
    (conn.models["LearnerModel"] as Model<LearnerModel>) ??
    conn.model<LearnerModel>("LearnerModel", LearnerModelSchema, "learner_models")
  );
}
