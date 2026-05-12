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
  },
  { _id: false, timestamps: { createdAt: "created_at" }, versionKey: false },
);

export function getPlatformAdminModel(): Model<PlatformAdmin> {
  return (
    (mongoose.models["PlatformAdmin"] as Model<PlatformAdmin>) ??
    mongoose.model<PlatformAdmin>("PlatformAdmin", PlatformAdminSchema)
  );
}
