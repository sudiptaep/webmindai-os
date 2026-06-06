import { getRedisConnection } from "../../services/queue.service";
import { computeHealth } from "./health";
import { saveSnapshot } from "./snapshot.helper";
import { fireAlert, checkAlertResolution } from "./alert.helper";

export async function runRedisProbe(): Promise<void> {
  const probeStart = Date.now();

  try {
    const redis = getRedisConnection();

    const info = await redis.info();
    const parsed: Record<string, string> = {};
    for (const line of info.split("\r\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx !== -1) {
        parsed[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
      }
    }

    const memUsedBytes = parseInt(parsed["used_memory"] || "0");
    const memMaxBytes = parseInt(parsed["maxmemory"] || "0");
    const memUsedMb = memUsedBytes / 1024 ** 2;
    const memMaxMb = memMaxBytes > 0 ? memMaxBytes / 1024 ** 2 : 0;
    const memUsedPct = memMaxMb > 0 ? (memUsedMb / memMaxMb) * 100 : 0;

    const connectedClients = parseInt(parsed["connected_clients"] || "0");
    const maxClients = parseInt(process.env.REDIS_MAXCLIENTS || "100");
    const connectedClientsPct = (connectedClients / maxClients) * 100;

    const hits = parseFloat(parsed["keyspace_hits"] || "0");
    const misses = parseFloat(parsed["keyspace_misses"] || "0");
    const hitRate = hits > 0 ? (hits / (hits + misses)) * 100 : 0;

    const db0Info = parsed["db0"] || "";
    const totalKeys = parseInt(db0Info.match(/keys=(\d+)/)?.[1] || "0");

    // BullMQ queue depths
    const queueNames = (process.env.BULLMQ_QUEUE_NAMES || "ingestion_jobs,chapter_extraction,pyq_ingestion,telemetry_alerts").split(",");
    const queueDepths: Record<string, { waiting: number; active: number; failed: number }> = {};

    for (const queueName of queueNames) {
      try {
        const waiting = await redis.llen(`bull:${queueName}:wait`);
        const active = await redis.llen(`bull:${queueName}:active`);
        const failed = await redis.llen(`bull:${queueName}:failed`);
        queueDepths[queueName.trim()] = { waiting, active, failed };
      } catch { /* queue doesn't exist yet */ }
    }

    const totalQueueDepth = Object.values(queueDepths).reduce(
      (sum, q) => sum + q.waiting + q.active,
      0,
    );

    const metrics = {
      memory_used_mb: memUsedMb,
      memory_max_mb: memMaxMb,
      memory_used_pct: memUsedPct,
      connected_clients: connectedClients,
      connected_clients_pct: connectedClientsPct,
      keyspace_hit_rate_pct: hitRate,
      total_keys: totalKeys,
      uptime_days: parseInt(parsed["uptime_in_days"] || "0"),
      queue_depths: queueDepths,
      total_queue_depth: totalQueueDepth,
      ops_per_sec: parseInt(parsed["instantaneous_ops_per_sec"] || "0"),
    };

    const { status, reasons } = computeHealth("redis", {
      memory_used_pct: memUsedPct,
      queue_depth: totalQueueDepth,
      connected_clients_pct: connectedClientsPct,
    });

    await saveSnapshot({
      service: "redis",
      snapshot_type: "platform",
      college_id: null,
      dept_id: null,
      metrics,
      health_status: status,
      health_reasons: reasons,
      probe_duration_ms: Date.now() - probeStart,
    });

    await checkAlertResolution("redis", status);

    if (memUsedPct >= 85) {
      await fireAlert({
        alert_type: "redis_memory_high",
        severity: "critical",
        service: "redis",
        title: "Redis memory critically high",
        message: `Redis memory at ${memUsedPct.toFixed(1)}% of ${memMaxMb.toFixed(0)} MB maxmemory.`,
        metric_name: "memory_used_pct",
        metric_value: memUsedPct,
        threshold_value: 85,
        unit: "%",
      });
    } else if (memUsedPct >= 70) {
      await fireAlert({
        alert_type: "redis_memory_high",
        severity: "warning",
        service: "redis",
        title: "Redis memory high",
        message: `Redis memory at ${memUsedPct.toFixed(1)}%.`,
        metric_name: "memory_used_pct",
        metric_value: memUsedPct,
        threshold_value: 70,
        unit: "%",
      });
    }

    if (totalQueueDepth >= 2000) {
      await fireAlert({
        alert_type: "redis_queue_depth_high",
        severity: "critical",
        service: "redis",
        title: "BullMQ queue depth critical",
        message: `Total queue depth is ${totalQueueDepth} jobs (>2000 threshold). Jobs may be backing up.`,
        metric_name: "queue_depth",
        metric_value: totalQueueDepth,
        threshold_value: 2000,
        unit: "jobs",
      });
    }
  } catch (err) {
    console.error("[redis.probe] failed:", err);
  }
}
