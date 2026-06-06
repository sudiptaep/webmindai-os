import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";

export type ObservatoryAlertType =
  | "mongodb_connection_pool_exhausted" | "mongodb_storage_high" | "mongodb_query_latency_spike" | "mongodb_replication_lag"
  | "anthropic_rate_limit_hit" | "anthropic_error_rate_high" | "anthropic_quota_low" | "anthropic_latency_spike"
  | "openai_rate_limit_hit" | "openai_error_rate_high" | "openai_quota_low"
  | "pinecone_storage_critical" | "pinecone_pod_unhealthy" | "pinecone_query_latency_spike" | "pinecone_namespace_not_found"
  | "disk_storage_high" | "disk_storage_critical" | "disk_inode_high"
  | "redis_memory_high" | "redis_queue_depth_high" | "redis_connection_refused"
  | "platform_wide_degradation";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved" | "auto_resolved";

export interface ObservatoryAlert {
  _id: string;
  alert_type: ObservatoryAlertType;
  severity: AlertSeverity;
  service: string;
  college_id: string | null;
  dept_id: string | null;
  title: string;
  message: string;
  metric_name: string;
  metric_value: number;
  threshold_value: number;
  unit: string;
  status: AlertStatus;
  first_fired_at: Date;
  last_fired_at: Date;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  resolved_at: Date | null;
  auto_resolved: boolean;
  notification_sent: boolean;
  notification_sent_at: Date | null;
}

const ObservatoryAlertSchema = new Schema<ObservatoryAlert>(
  {
    _id: { type: String, default: () => randomUUID() },
    alert_type: { type: String, required: true },
    severity: { type: String, enum: ["info", "warning", "critical"], required: true },
    service: { type: String, required: true },
    college_id: { type: String, default: null },
    dept_id: { type: String, default: null },
    title: { type: String, required: true },
    message: { type: String, required: true },
    metric_name: { type: String, required: true },
    metric_value: { type: Number, required: true },
    threshold_value: { type: Number, required: true },
    unit: { type: String, default: "" },
    status: { type: String, enum: ["active", "acknowledged", "resolved", "auto_resolved"], default: "active" },
    first_fired_at: { type: Date, required: true },
    last_fired_at: { type: Date, required: true },
    acknowledged_by: { type: String, default: null },
    acknowledged_at: { type: Date, default: null },
    resolved_at: { type: Date, default: null },
    auto_resolved: { type: Boolean, default: false },
    notification_sent: { type: Boolean, default: false },
    notification_sent_at: { type: Date, default: null },
  },
  { _id: false, timestamps: false, versionKey: false },
);

ObservatoryAlertSchema.index({ status: 1, severity: 1, first_fired_at: -1 });
ObservatoryAlertSchema.index({ service: 1, status: 1, first_fired_at: -1 });
ObservatoryAlertSchema.index({ college_id: 1, status: 1 });

export function getObservatoryAlertModel(): Model<ObservatoryAlert> {
  return (
    (mongoose.models["ObservatoryAlert"] as Model<ObservatoryAlert>) ??
    mongoose.model<ObservatoryAlert>("ObservatoryAlert", ObservatoryAlertSchema)
  );
}
