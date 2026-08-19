import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type {
  TeachingSession, PendingCheck, CheckHistoryEntry, TeachingTurnRecord,
  BacktrackStackEntry, TeachingSessionStatus, ExplanationStrategy,
} from "@college-chatbot/shared";

const STRATEGIES: ExplanationStrategy[] = [
  "analogy", "first_principles", "worked_example", "contrast_pair", "concrete_instance",
  "visual_spatial", "extreme_case", "error_analysis", "narrative_history", "mnemonic",
];

const PendingCheckSchema = new Schema<PendingCheck>(
  {
    question: { type: String, required: true },
    expected_answer: { type: String, required: true },
    bloom_level: { type: String, default: "understand" },
  },
  { _id: false },
);

const CheckHistoryEntrySchema = new Schema<CheckHistoryEntry>(
  {
    phase: { type: Number, required: true },
    step_index: { type: Number, required: true },
    question: { type: String, required: true },
    expected_answer: { type: String, default: "" },
    student_answer: { type: String, required: true },
    passed: { type: Boolean, required: true },
    confidence: { type: Number, required: true },
    partial_credit: { type: Boolean, default: false },
    difficulty_level: { type: Number, required: true },
    strategy_used: { type: String, enum: STRATEGIES },
    diagnosed_gap: { type: String },
    matched_misconception_id: { type: String },
    timestamp: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const TeachingTurnRecordSchema = new Schema<TeachingTurnRecord>(
  {
    role: { type: String, enum: ["assistant", "student"], required: true },
    phase: { type: Number, required: true },
    content: { type: String, required: true },
    strategy: { type: String, enum: STRATEGIES },
    difficulty_level: { type: Number },
    image_asset_id: { type: String },
    created_at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const BacktrackStackEntrySchema = new Schema<BacktrackStackEntry>(
  {
    prerequisite_concept_id: { type: String, required: true },
    parent_phase: { type: Number, required: true },
    parent_step_index: { type: Number, required: true },
    opened_at: { type: Date, default: () => new Date() },
    closed_at: { type: Date },
  },
  { _id: false },
);

const TeachingSessionSchema = new Schema<TeachingSession>(
  {
    _id:         { type: String, default: () => randomUUID() },
    student_id:  { type: String, required: true },
    college_id:  { type: String, required: true },
    dept_id:     { type: String, required: true },
    subject_id:  { type: String },
    doc_id:      { type: String, required: true },
    concept_id:  { type: String, required: true },

    parent_session_id: { type: String },
    is_nested:          { type: Boolean, default: false },
    backtrack_stack:    { type: [BacktrackStackEntrySchema], default: [] },
    backtrack_active:   { type: Boolean, default: false },

    current_phase:             { type: Number, default: 0 },
    current_step_index:        { type: Number, default: 0 },
    build_steps_total:         { type: Number, default: 4 },
    build_steps_remaining:     { type: Number, default: 4 },
    current_difficulty_level:  { type: Number, default: 2 },
    current_strategy:          { type: String, enum: STRATEGIES },
    strategies_attempted:      { type: [String], enum: STRATEGIES, default: [] },
    strategies_failed:         { type: [String], enum: STRATEGIES, default: [] },
    enabled_phases:            { type: [Number] },
    phase_turn_count:          { type: Number, default: 0 },
    turn_count:                { type: Number, default: 0 },

    awaiting_check_response: { type: Boolean, default: false },
    pending_check:           { type: PendingCheckSchema, default: null },

    turns:         { type: [TeachingTurnRecordSchema], default: [] },
    check_history: { type: [CheckHistoryEntrySchema], default: [] },

    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned"] as TeachingSessionStatus[],
      default: "in_progress",
    },
    misconception_addressed_id: { type: String },
    misconception_corrected:    { type: Boolean },
    feynman_score:               { type: Number },
    final_mastery_estimate:      { type: Number },
    srs_cards_created:           { type: [String], default: [] },
    consolidation_summary:       { type: String },

    total_checks:          { type: Number, default: 0 },
    checks_passed:         { type: Number, default: 0 },
    rungs_dropped:         { type: Number, default: 0 },
    backtracks_triggered:  { type: Number, default: 0 },
    duration_seconds:      { type: Number },
    tokens_used:           { type: Number, default: 0 },
    cost_usd:              { type: Number, default: 0 },

    started_at:   { type: Date, default: () => new Date() },
    completed_at: { type: Date },
  },
  { _id: false, versionKey: false },
);

TeachingSessionSchema.index({ student_id: 1, started_at: -1 });
TeachingSessionSchema.index({ concept_id: 1, status: 1 });
TeachingSessionSchema.index({ dept_id: 1, started_at: -1 });
TeachingSessionSchema.index({ parent_session_id: 1 });

export function getTeachingSessionModel(conn: Connection): Model<TeachingSession> {
  return (
    (conn.models["TeachingSession"] as Model<TeachingSession>) ??
    conn.model<TeachingSession>("TeachingSession", TeachingSessionSchema, "teaching_sessions")
  );
}
