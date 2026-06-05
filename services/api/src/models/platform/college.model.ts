import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";
import type { College, CollegeStatus, CollegeType } from "@college-chatbot/shared";

const CollegeSchema = new Schema<College>(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true },
    type: { type: String, enum: ["engineering", "medical", "other"] as CollegeType[], required: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    status: { type: String, enum: ["active", "suspended", "deleted"] as CollegeStatus[], default: "active" },
    owner_admin_id: { type: String, required: false },
    pinecone_prefix: { type: String, required: true },
    r2_prefix: { type: String, required: true },
    mongo_db_name: { type: String, required: true },
    token_limit_per_month: { type: Number, default: 5_000_000 },
    tokens_used_this_month: { type: Number, default: 0 },
    college_admin_count: { type: Number, default: 0 },
    dept_admin_count: { type: Number, default: 0 },
    primary_contact_email: { type: String },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

export function getCollegeModel(): Model<College> {
  return (mongoose.models["College"] as Model<College>) ?? mongoose.model<College>("College", CollegeSchema);
}
