import type { HealthStatus } from "../../models/platform/service-snapshot.model";

interface ThresholdPair {
  warning: number;
  critical: number;
}

const HEALTH_THRESHOLDS: Record<string, Record<string, ThresholdPair>> = {
  mongodb: {
    storage_pct:         { warning: 70, critical: 85 },
    query_latency_ms:    { warning: 200, critical: 500 },
    connections_pct:     { warning: 70, critical: 85 },
    replication_lag_sec: { warning: 10, critical: 30 },
  },
  anthropic: {
    error_rate_pct:      { warning: 2, critical: 10 },
    rpm_vs_limit_pct:    { warning: 70, critical: 90 },
    avg_latency_ms:      { warning: 3000, critical: 8000 },
    quota_remaining_pct: { warning: 20, critical: 5 },
  },
  openai: {
    error_rate_pct:      { warning: 2, critical: 10 },
    rpm_vs_limit_pct:    { warning: 70, critical: 90 },
    avg_latency_ms:      { warning: 2000, critical: 5000 },
    quota_remaining_pct: { warning: 20, critical: 5 },
  },
  pinecone: {
    storage_pct:         { warning: 75, critical: 90 },
    query_latency_ms:    { warning: 500, critical: 1500 },
  },
  disk: {
    used_pct:            { warning: 75, critical: 90 },
    inode_used_pct:      { warning: 80, critical: 95 },
  },
  redis: {
    memory_used_pct:        { warning: 70, critical: 85 },
    queue_depth:            { warning: 500, critical: 2000 },
    connected_clients_pct:  { warning: 70, critical: 85 },
  },
};

export function computeHealth(
  service: string,
  metrics: Record<string, number>,
): { status: HealthStatus; reasons: string[] } {
  const thresholds = HEALTH_THRESHOLDS[service];
  if (!thresholds) return { status: "unknown", reasons: [`No thresholds for service: ${service}`] };

  const reasons: string[] = [];
  let worstStatus: HealthStatus = "healthy";

  for (const [metric, value] of Object.entries(metrics)) {
    if (!(metric in thresholds)) continue;
    const { warning, critical } = thresholds[metric];

    if (value >= critical) {
      reasons.push(`${metric} at ${value} (critical threshold: ${critical})`);
      worstStatus = "critical";
    } else if (value >= warning && worstStatus !== "critical") {
      reasons.push(`${metric} at ${value} (warning threshold: ${warning})`);
      worstStatus = "warning";
    }
  }

  return { status: worstStatus, reasons };
}
