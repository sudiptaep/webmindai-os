import { Pinecone } from "@pinecone-database/pinecone";
import { getCollegeModel } from "../../models/platform/college.model";
import { getRedisConnection } from "../../services/queue.service";
import { getBillingDay } from "../../services/metering.service";
import { computeHealth } from "./health";
import { saveSnapshot } from "./snapshot.helper";
import { fireAlert, checkAlertResolution } from "./alert.helper";

export async function runPineconeProbe(): Promise<void> {
  const probeStart = Date.now();

  try {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const indexName = process.env.PINECONE_INDEX_NAME!;

    const indexDescription = await pc.describeIndex(indexName);
    const indexStats = await pc.index(indexName).describeIndexStats();

    const totalVectors = indexStats.totalRecordCount ?? 0;
    const dimensionCount = indexDescription.dimension ?? 1536;
    const storageGb = (totalVectors * dimensionCount * 4) / 1024 ** 3;
    const podStatus = (indexDescription.status as { state?: string })?.state ?? "unknown";
    const isReady = (indexDescription.status as { ready?: boolean })?.ready ?? false;

    const namespaceStats = indexStats.namespaces ?? {};
    const College = getCollegeModel();
    const colleges = await College.find({ status: "active" }).lean();

    const namespaceBreakdown: Array<{
      college_name: string;
      dept_id: string;
      namespace: string;
      vector_count: number;
      storage_mb: number;
    }> = [];

    for (const [namespace, nsData] of Object.entries(namespaceStats)) {
      const match = namespace.match(/^c_([^_]+)_d_(.+?)(_pyq)?$/);
      if (!match) continue;

      const collegeId = match[1];
      const deptId = match[2];
      const isPyq = !!match[3];

      const college = colleges.find((c) => (c._id as string).replace(/-/g, "").startsWith(collegeId) || c._id === collegeId);
      const collegeName = college?.name ?? collegeId;

      const vecCount = (nsData as { recordCount?: number }).recordCount ?? 0;
      namespaceBreakdown.push({
        college_name: isPyq ? `${collegeName} (PYQ)` : collegeName,
        dept_id: deptId,
        namespace,
        vector_count: vecCount,
        storage_mb: (vecCount * dimensionCount * 4) / 1024 ** 2,
      });
    }

    namespaceBreakdown.sort((a, b) => b.vector_count - a.vector_count);

    const redis = getRedisConnection();
    const today = getBillingDay();
    const ruReadToday = parseInt((await redis.get(`pinecone:ru_read:${today}`)) || "0");
    const ruWriteToday = parseInt((await redis.get(`pinecone:ru_write:${today}`)) || "0");
    const queryLatencyP50 = parseInt((await redis.get("pinecone:latency_p50_ms")) || "0");
    const queryLatencyP95 = parseInt((await redis.get("pinecone:latency_p95_ms")) || "0");

    const storageLimit = parseFloat(process.env.PINECONE_STORAGE_LIMIT_GB || "10");
    const storagePct = (storageGb / storageLimit) * 100;

    const metrics = {
      total_vectors: totalVectors,
      storage_gb: storageGb,
      storage_pct: storagePct,
      storage_limit_gb: storageLimit,
      pod_status: podStatus,
      is_ready: isReady,
      dimension: dimensionCount,
      namespace_count: Object.keys(namespaceStats).length,
      namespace_breakdown: namespaceBreakdown.slice(0, 20),
      ru_read_today: ruReadToday,
      ru_write_today: ruWriteToday,
      query_latency_ms: queryLatencyP50,
      query_latency_p95_ms: queryLatencyP95,
    };

    const { status: computedStatus, reasons: computedReasons } = computeHealth("pinecone", {
      storage_pct: storagePct,
      query_latency_ms: queryLatencyP50,
    });

    const health_status = !isReady ? "critical" : computedStatus;
    const health_reasons = !isReady ? ["Pinecone index is not in Ready state", ...computedReasons] : computedReasons;

    await saveSnapshot({
      service: "pinecone",
      snapshot_type: "platform",
      college_id: null,
      dept_id: null,
      metrics,
      health_status,
      health_reasons,
      probe_duration_ms: Date.now() - probeStart,
    });

    await checkAlertResolution("pinecone", health_status);

    if (!isReady) {
      await fireAlert({
        alert_type: "pinecone_pod_unhealthy",
        severity: "critical",
        service: "pinecone",
        title: "Pinecone index not ready",
        message: `Pinecone index "${indexName}" is in state "${podStatus}" — queries will fail.`,
        metric_name: "is_ready",
        metric_value: 0,
        threshold_value: 1,
        unit: "bool",
      });
    }

    if (storagePct >= 90) {
      await fireAlert({
        alert_type: "pinecone_storage_critical",
        severity: "critical",
        service: "pinecone",
        title: "Pinecone storage critical",
        message: `Pinecone index at ${storagePct.toFixed(1)}% of ${storageLimit} GB limit. New vector writes may fail soon.`,
        metric_name: "storage_pct",
        metric_value: storagePct,
        threshold_value: 90,
        unit: "%",
      });
    } else if (storagePct >= 75) {
      await fireAlert({
        alert_type: "pinecone_storage_critical",
        severity: "warning",
        service: "pinecone",
        title: "Pinecone storage high",
        message: `Pinecone index at ${storagePct.toFixed(1)}% of ${storageLimit} GB storage limit.`,
        metric_name: "storage_pct",
        metric_value: storagePct,
        threshold_value: 75,
        unit: "%",
      });
    }
  } catch (err) {
    console.error("[pinecone.probe] failed:", err);
  }
}

// Called by pinecone.service.ts after every query/upsert
export async function updatePineconeMetrics(
  latencyMs: number,
  readUnits: number,
  writeUnits: number,
): Promise<void> {
  try {
    const redis = getRedisConnection();
    const today = getBillingDay();
    const pipe = redis.pipeline();

    if (readUnits > 0) {
      pipe.incrby(`pinecone:ru_read:${today}`, readUnits);
      pipe.expire(`pinecone:ru_read:${today}`, 172800);
    }
    if (writeUnits > 0) {
      pipe.incrby(`pinecone:ru_write:${today}`, writeUnits);
      pipe.expire(`pinecone:ru_write:${today}`, 172800);
    }

    pipe.lpush("pinecone:latency_samples", latencyMs);
    pipe.ltrim("pinecone:latency_samples", 0, 99);

    await pipe.exec();

    setImmediate(async () => {
      try {
        const samples = await redis.lrange("pinecone:latency_samples", 0, -1);
        const sorted = samples.map(Number).sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        await redis.mset("pinecone:latency_p50_ms", p50, "pinecone:latency_p95_ms", p95);
      } catch { /* ignore */ }
    });
  } catch (err) {
    console.error("[updatePineconeMetrics] failed:", err);
  }
}
