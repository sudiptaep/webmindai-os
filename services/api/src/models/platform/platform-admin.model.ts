import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";
import type { PlatformAdmin } from "@college-chatbot/shared";

const PlatformAdminSchema = new Schema<PlatformAdmin>(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, default: "Super Admin" },
    email: { type: String, required: true, unique: true, lowercase: true },
    password_hash: { type: String, required: true },
    role: { type: String, default: "super_admin" },
    avatar_initials: { type: String },
    last_login: { type: Date },
    mfa_enabled: { type: Boolean, default: false },
    mfa_secret: { type: String },
    failed_login_attempts: { type: Number, default: 0 },
    locked_until: { type: Date },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

export function getPlatformAdminModel(): Model<PlatformAdmin> {
  return (
    (mongoose.models["PlatformAdmin"] as Model<PlatformAdmin>) ??
    mongoose.model<PlatformAdmin>("PlatformAdmin", PlatformAdminSchema)
  );
}
