import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";
import type { CostEventService } from "./cost-event.model";

export interface RateTableEntry {
  _id: string;
  service: CostEventService;
  model: string;
  input_token_cost_per_1k: number;
  output_token_cost_per_1k: number;
  per_unit_cost: number;
  storage_cost_per_gb_per_month: number;
  effective_from: Date;
  notes?: string;
  updated_by?: string;
  updated_at: Date;
}

const RateTableSchema = new Schema<RateTableEntry>(
  {
    _id: { type: String, default: () => randomUUID() },
    service: { type: String, enum: ["anthropic","openai_embeddings","cohere","pinecone","openai_vision"], required: true },
    model: { type: String, required: true },
    input_token_cost_per_1k: { type: Number, default: 0 },
    output_token_cost_per_1k: { type: Number, default: 0 },
    per_unit_cost: { type: Number, default: 0 },
    storage_cost_per_gb_per_month: { type: Number, default: 0 },
    effective_from: { type: Date, default: () => new Date() },
    notes: { type: String },
    updated_by: { type: String },
  },
  { _id: false, timestamps: { updatedAt: "updated_at" }, versionKey: false },
);

RateTableSchema.index({ service: 1, model: 1 }, { unique: true });

export function getRateTableModel(): Model<RateTableEntry> {
  return (
    (mongoose.models["RateTable"] as Model<RateTableEntry>) ??
    mongoose.model<RateTableEntry>("RateTable", RateTableSchema)
  );
}
