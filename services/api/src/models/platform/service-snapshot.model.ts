import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";

export type SnapshotService = "mongodb" | "anthropic" | "openai_embeddings" | "pinecone" | "local_disk" | "redis";
export type SnapshotType = "platform" | "college" | "dept";
export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

export interface ServiceSnapshot {
  _id: string;
  service: SnapshotService;
  snapshot_type: SnapshotType;
  college_id: string | null;
  dept_id: string | null;
  captured_at: Date;
  probe_duration_ms: number;
  metrics: Record<string, unknown>;
  health_status: HealthStatus;
  health_reasons: string[];
  expires_at: Date;
}

const ServiceSnapshotSchema = new Schema<ServiceSnapshot>(
  {
    _id: { type: String, default: () => randomUUID() },
    service: {
      type: String,
      enum: ["mongodb", "anthropic", "openai_embeddings", "pinecone", "local_disk", "redis"],
      required: true,
    },
    snapshot_type: { type: String, enum: ["platform", "college", "dept"], required: true },
    college_id: { type: String, default: null },
    dept_id: { type: String, default: null },
    captured_at: { type: Date, required: true },
    probe_duration_ms: { type: Number, default: 0 },
    metrics: { type: Schema.Types.Mixed, required: true },
    health_status: { type: String, enum: ["healthy", "warning", "critical", "unknown"], default: "unknown" },
    health_reasons: [{ type: String }],
    expires_at: { type: Date, required: true },
  },
  { _id: false, timestamps: false, versionKey: false },
);

ServiceSnapshotSchema.index({ service: 1, snapshot_type: 1, captured_at: -1 });
ServiceSnapshotSchema.index({ college_id: 1, service: 1, captured_at: -1 });
ServiceSnapshotSchema.index({ dept_id: 1, service: 1, captured_at: -1 });
ServiceSnapshotSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
ServiceSnapshotSchema.index({ health_status: 1, captured_at: -1 });

export function getServiceSnapshotModel(): Model<ServiceSnapshot> {
  return (
    (mongoose.models["ServiceSnapshot"] as Model<ServiceSnapshot>) ??
    mongoose.model<ServiceSnapshot>("ServiceSnapshot", ServiceSnapshotSchema)
  );
}
