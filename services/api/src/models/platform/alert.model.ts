import { randomUUID } from "crypto";
import mongoose, { Schema, type Model } from "mongoose";

export type AlertType =
  | "COLLEGE_TOKEN_SOFT_WARN"
  | "COLLEGE_TOKEN_HARD_STOP"
  | "COLLEGE_BUDGET_WARN"
  | "COLLEGE_BUDGET_EXCEEDED"
  | "DEPT_TOKEN_SOFT_WARN"
  | "COST_ANOMALY";

export type AlertSeverity = "critical" | "warning";
export type AlertStatus = "active" | "resolved";

export interface Alert {
  _id: string;
  college_id: string;
  dept_id?: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  message: string;
  value: number;
  status: AlertStatus;
  resolved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const AlertSchema = new Schema<Alert>(
  {
    _id: { type: String, default: () => randomUUID() },
    college_id: { type: String, required: true },
    dept_id: { type: String },
    alert_type: {
      type: String,
      enum: ["COLLEGE_TOKEN_SOFT_WARN","COLLEGE_TOKEN_HARD_STOP","COLLEGE_BUDGET_WARN","COLLEGE_BUDGET_EXCEEDED","DEPT_TOKEN_SOFT_WARN","COST_ANOMALY"],
      required: true,
    },
    severity: { type: String, enum: ["critical","warning"], required: true },
    message: { type: String, required: true },
    value: { type: Number, required: true },
    status: { type: String, enum: ["active","resolved"], default: "active" },
    resolved_at: { type: Date },
  },
  { _id: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, versionKey: false },
);

AlertSchema.index({ college_id: 1, status: 1 });
AlertSchema.index({ college_id: 1, alert_type: 1 }, { unique: true, partialFilterExpression: { status: "active" } });

export function getAlertModel(): Model<Alert> {
  return (
    (mongoose.models["Alert"] as Model<Alert>) ??
    mongoose.model<Alert>("Alert", AlertSchema)
  );
}
