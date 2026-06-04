import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";

export type PolicyTargetType = "global" | "college" | "dept";

export interface CostPolicy {
  _id: string;
  target_type: PolicyTargetType;
  target_id: string;              // "global" | college_id | dept_id
  college_id?: string;            // null for global; dept's college for dept policies

  llm_token_limit_per_month?: number;
  llm_token_soft_warn_pct?: number;
  llm_token_hard_stop?: boolean;

  max_chat_queries_per_student_per_day?: number;
  max_ai_summaries_per_student_per_day?: number;
  max_exam_gen_per_student_per_day?: number;

  allowed_llm_models?: string[];
  embedding_model?: string;

  cost_budget_usd_per_month?: number;
  cost_soft_warn_pct?: number;

  storage_limit_gb?: number;

  notes?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

const CostPolicySchema = new Schema<CostPolicy>(
  {
    _id: { type: String, default: () => randomUUID() },
    target_type: { type: String, enum: ["global", "college", "dept"], required: true },
    target_id: { type: String, required: true },
    college_id: { type: String },

    llm_token_limit_per_month: { type: Number },
    llm_token_soft_warn_pct: { type: Number, default: 80 },
    llm_token_hard_stop: { type: Boolean, default: true },

    max_chat_queries_per_student_per_day: { type: Number },
    max_ai_summaries_per_student_per_day: { type: Number },
    max_exam_gen_per_student_per_day: { type: Number },

    allowed_llm_models: [{ type: String }],
    embedding_model: { type: String },

    cost_budget_usd_per_month: { type: Number },
    cost_soft_warn_pct: { type: Number, default: 75 },

    storage_limit_gb: { type: Number },

    notes: { type: String },
    created_by: { type: String },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

CostPolicySchema.index({ target_type: 1, target_id: 1 }, { unique: true });
CostPolicySchema.index({ college_id: 1 });

export function getCostPolicyModel(): Model<CostPolicy> {
  return (
    (mongoose.models["CostPolicy"] as Model<CostPolicy>) ??
    mongoose.model<CostPolicy>("CostPolicy", CostPolicySchema)
  );
}
