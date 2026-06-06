import { getServiceSnapshotModel, type SnapshotService, type SnapshotType, type HealthStatus } from "../../models/platform/service-snapshot.model";

const TTL_MS: Record<string, number> = {
  "1min":  24 * 3600 * 1000,          // Anthropic, OpenAI — keep 24h
  "5min":  7 * 24 * 3600 * 1000,      // MongoDB, Pinecone, Redis — keep 7 days
  "15min": 30 * 24 * 3600 * 1000,     // Disk — keep 30 days
};

function expiresAt(bucket: "1min" | "5min" | "15min"): Date {
  return new Date(Date.now() + TTL_MS[bucket]);
}

export interface SaveSnapshotParams {
  service: SnapshotService;
  snapshot_type: SnapshotType;
  college_id: string | null;
  dept_id: string | null;
  metrics: Record<string, unknown>;
  health_status: HealthStatus;
  health_reasons: string[];
  probe_duration_ms: number;
  ttl_bucket?: "1min" | "5min" | "15min";
}

export async function saveSnapshot(params: SaveSnapshotParams): Promise<void> {
  try {
    const Model = getServiceSnapshotModel();
    const bucket = params.ttl_bucket ?? serviceBucket(params.service);
    await Model.create({
      service: params.service,
      snapshot_type: params.snapshot_type,
      college_id: params.college_id,
      dept_id: params.dept_id,
      captured_at: new Date(),
      probe_duration_ms: params.probe_duration_ms,
      metrics: params.metrics,
      health_status: params.health_status,
      health_reasons: params.health_reasons,
      expires_at: expiresAt(bucket),
    });
  } catch (err) {
    console.error(`[snapshot] failed to save snapshot for ${params.service}:`, err);
  }
}

function serviceBucket(service: SnapshotService): "1min" | "5min" | "15min" {
  if (service === "anthropic" || service === "openai_embeddings") return "1min";
  if (service === "local_disk") return "15min";
  return "5min";
}
