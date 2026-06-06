import { getObservatoryAlertModel, type ObservatoryAlertType, type AlertSeverity } from "../../models/platform/observatory-alert.model";
import { getServiceSnapshotModel } from "../../models/platform/service-snapshot.model";
import nodemailer from "nodemailer";

export interface AlertParams {
  alert_type: ObservatoryAlertType;
  severity: AlertSeverity;
  service: string;
  college_id?: string | null;
  dept_id?: string | null;
  title: string;
  message: string;
  metric_name: string;
  metric_value: number;
  threshold_value: number;
  unit?: string;
}

export async function fireAlert(params: AlertParams): Promise<void> {
  try {
    const Alert = getObservatoryAlertModel();
    const existing = await Alert.findOne({
      alert_type: params.alert_type,
      college_id: params.college_id ?? null,
      status: "active",
    }).lean();

    if (existing) {
      await Alert.updateOne(
        { _id: existing._id },
        { $set: { last_fired_at: new Date(), metric_value: params.metric_value } },
      );
      return;
    }

    const now = new Date();
    const alert = await Alert.create({
      alert_type: params.alert_type,
      severity: params.severity,
      service: params.service,
      college_id: params.college_id ?? null,
      dept_id: params.dept_id ?? null,
      title: params.title,
      message: params.message,
      metric_name: params.metric_name,
      metric_value: params.metric_value,
      threshold_value: params.threshold_value,
      unit: params.unit ?? "",
      status: "active",
      first_fired_at: now,
      last_fired_at: now,
      notification_sent: false,
    });

    if (params.severity !== "info") {
      await sendAlertEmail(alert.title, alert.message, params.severity);
      await Alert.updateOne({ _id: alert._id }, { $set: { notification_sent: true, notification_sent_at: new Date() } });
    }
  } catch (err) {
    console.error("[alert] fireAlert failed:", err);
  }
}

export async function checkAlertResolution(service: string, currentHealth: string): Promise<void> {
  if (currentHealth !== "healthy") return;
  try {
    const Alert = getObservatoryAlertModel();
    await Alert.updateMany(
      { service, status: "active", severity: { $in: ["warning", "info"] } },
      { $set: { status: "auto_resolved", resolved_at: new Date(), auto_resolved: true } },
    );
  } catch (err) {
    console.error("[alert] checkAlertResolution failed:", err);
  }
}

export async function detectSpike(service: string, currentValue: number, metric: string): Promise<void> {
  try {
    const hourOfDay = new Date().getHours();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const Snapshot = getServiceSnapshotModel();
    const historical = await Snapshot.find({
      service,
      snapshot_type: "platform",
      captured_at: { $gte: sevenDaysAgo },
      $expr: { $eq: [{ $hour: "$captured_at" }, hourOfDay] },
    }).lean();

    if (historical.length < 5) return;

    const values = historical.map((s) => (s.metrics as Record<string, number>)[metric] ?? 0);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length);

    if (currentValue > avg + 3 * stdDev && currentValue > avg * 2) {
      await fireAlert({
        alert_type: "platform_wide_degradation",
        severity: "warning",
        service,
        title: `Unusual ${metric} spike on ${service}`,
        message: `Current ${metric}: ${currentValue} vs 7-day avg: ${Math.round(avg)}. This is ${Math.round(currentValue / avg)}× normal.`,
        metric_name: metric,
        metric_value: currentValue,
        threshold_value: avg * 2,
        unit: "",
      });
    }
  } catch (err) {
    console.error("[alert] detectSpike failed:", err);
  }
}

async function sendAlertEmail(title: string, message: string, severity: AlertSeverity): Promise<void> {
  try {
    const to = process.env.OBSERVATORY_ALERT_EMAIL_TO;
    if (!to) return;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const severityColor = severity === "critical" ? "#dc2626" : "#d97706";
    const severityLabel = severity.toUpperCase();

    await transporter.sendMail({
      from: `"EduMind AI Observatory" <${process.env.SMTP_USER}>`,
      to,
      cc: process.env.OBSERVATORY_ALERT_EMAIL_CC,
      subject: `[${severityLabel}] ${title}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px">
          <div style="background:${severityColor};color:#fff;padding:12px 20px;border-radius:6px 6px 0 0">
            <strong>[${severityLabel}] ${title}</strong>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 6px 6px">
            <p>${message}</p>
            <p style="color:#6b7280;font-size:13px">
              EduMind AI Observatory — ${new Date().toISOString()}<br/>
              Log in to super admin to acknowledge or resolve this alert.
            </p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error("[alert] sendAlertEmail failed:", err);
  }
}
