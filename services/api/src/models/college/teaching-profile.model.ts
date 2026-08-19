import { randomUUID } from "crypto";
import { Schema, type Connection, type Model } from "mongoose";
import type {
  TeachingProfile, ExplanationStrategy, AnalogyPolicy, MnemonicPolicy, RigourLevel, BloomLevel,
} from "@college-chatbot/shared";

const STRATEGIES: ExplanationStrategy[] = [
  "analogy", "first_principles", "worked_example", "contrast_pair", "concrete_instance",
  "visual_spatial", "extreme_case", "error_analysis", "narrative_history", "mnemonic",
];

const TeachingProfileSchema = new Schema<TeachingProfile>(
  {
    _id:        { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    dept_id:    { type: String, required: true },

    strategy_preference_order: { type: [String], enum: STRATEGIES, default: () => [...STRATEGIES] },

    analogy_policy:  { type: String, enum: ["sparing", "liberal", "avoid"] as AnalogyPolicy[], default: "sparing" },
    mnemonic_policy: { type: String, enum: ["freely", "only_for_lists", "avoid"] as MnemonicPolicy[], default: "only_for_lists" },
    rigour_level:    { type: String, enum: ["high", "balanced", "accessible"] as RigourLevel[], default: "balanced" },

    always_include_clinical_connect: { type: Boolean, default: true },
    require_feynman_check:           { type: Boolean, default: true },
    require_misconception_probe:     { type: Boolean, default: true },

    default_bloom_target:    { type: String, enum: ["remember", "understand", "apply", "analyse"] as BloomLevel[], default: "apply" },
    default_entry_difficulty: { type: Number, default: 2, min: 0, max: 3 },
    max_session_minutes:      { type: Number, default: 20 },
    max_backtrack_depth:      { type: Number, default: 2 },

    custom_instruction: { type: String, default: "" },
    configured_by:      { type: String },
  },
  { _id: false, timestamps: { createdAt: false, updatedAt: "updated_at" }, versionKey: false },
);

TeachingProfileSchema.index({ dept_id: 1 }, { unique: true });

export function getTeachingProfileModel(conn: Connection): Model<TeachingProfile> {
  return (
    (conn.models["TeachingProfile"] as Model<TeachingProfile>) ??
    conn.model<TeachingProfile>("TeachingProfile", TeachingProfileSchema, "teaching_profiles")
  );
}
