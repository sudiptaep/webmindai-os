import { getServiceSnapshotModel } from "../models/platform/service-snapshot.model";
import { getDailyUsageRollupModel } from "../models/platform/daily-usage-rollup.model";
import { getCostEventModel } from "../models/platform/cost-event.model";
import { getCollegeModel } from "../models/platform/college.model";

function dateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function runRebuildDailyRollups(): Promise<void> {
  const targetDate = dateString(new Date(Date.now() - 24 * 3600 * 1000)); // yesterday

  console.info(`[rebuildDailyRollups] rebuilding rollup for ${targetDate}`);

  try {
    const Snapshot = getServiceSnapshotModel();
    const Rollup = getDailyUsageRollupModel();
    const CostEvent = getCostEventModel();
    const College = getCollegeModel();

    const dayStart = new Date(`${targetDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${targetDate}T23:59:59.999Z`);

    // ── Platform-wide rollup ─────────────────────────────────────
    const platformRollup = await buildRollup(Snapshot, CostEvent, dayStart, dayEnd, null, null);

    await Rollup.findOneAndUpdate(
      { date: targetDate, college_id: null, dept_id: null },
      { ...platformRollup, date: targetDate, college_id: null, dept_id: null, computed_at: new Date() },
      { upsert: true, new: true },
    );

    // ── Per-college rollups ───────────────────────────────────────
    const colleges = await College.find({ status: "active" }).lean();
    for (const college of colleges) {
      const collegeId = college._id as string;
      const collegeRollup = await buildCollegeRollup(Snapshot, CostEvent, dayStart, dayEnd, collegeId);

      await Rollup.findOneAndUpdate(
        { date: targetDate, college_id: collegeId, dept_id: null },
        { ...collegeRollup, date: targetDate, college_id: collegeId, dept_id: null, computed_at: new Date() },
        { upsert: true, new: true },
      );
    }

    console.info(`[rebuildDailyRollups] completed for ${targetDate}`);
  } catch (err) {
    console.error("[rebuildDailyRollups] failed:", err);
    throw err;
  }
}

async function buildRollup(
  Snapshot: ReturnType<typeof getServiceSnapshotModel>,
  CostEvent: ReturnType<typeof getCostEventModel>,
  dayStart: Date,
  dayEnd: Date,
  college_id: string | null,
  dept_id: string | null,
) {
  const snapshotFilter: Record<string, unknown> = {
    captured_at: { $gte: dayStart, $lte: dayEnd },
    snapshot_type: "platform",
  };

  // MongoDB stats from snapshots
  const mongoSnaps = await Snapshot.find({ ...snapshotFilter, service: "mongodb" }).lean();
  const lastMongoSnap = mongoSnaps[mongoSnaps.length - 1];
  const mongoMetrics = (lastMongoSnap?.metrics ?? {}) as Record<string, number>;
  const mongoLatencies = mongoSnaps.map((s) => (s.metrics as Record<string, number>).query_latency_ms ?? 0).filter(Boolean);
  const mongoConnections = mongoSnaps.map((s) => (s.metrics as Record<string, number>).active_connections ?? 0);

  // Anthropic stats from snapshots
  const anthropicSnaps = await Snapshot.find({ ...snapshotFilter, service: "anthropic" }).lean();
  const anthropicLatencies = anthropicSnaps.map((s) => (s.metrics as Record<string, number>).latency_p50_ms ?? 0).filter(Boolean);
  const lastAnthropicSnap = anthropicSnaps[anthropicSnaps.length - 1];
  const anthropicMetrics = (lastAnthropicSnap?.metrics ?? {}) as Record<string, number>;

  // OpenAI stats from snapshots
  const openaiSnaps = await Snapshot.find({ ...snapshotFilter, service: "openai_embeddings" }).lean();
  const lastOpenAISnap = openaiSnaps[openaiSnaps.length - 1];
  const openaiMetrics = (lastOpenAISnap?.metrics ?? {}) as Record<string, number>;
  const openaiLatencies = openaiSnaps.map((s) => (s.metrics as Record<string, number>).latency_p50_ms ?? 0).filter(Boolean);

  // Pinecone stats from snapshots
  const pineconeSnaps = await Snapshot.find({ ...snapshotFilter, service: "pinecone" }).lean();
  const lastPineconeSnap = pineconeSnaps[pineconeSnaps.length - 1];
  const pineconeMetrics = (lastPineconeSnap?.metrics ?? {}) as Record<string, number>;
  const pineconeLatencies = pineconeSnaps.map((s) => (s.metrics as Record<string, number>).query_latency_ms ?? 0).filter(Boolean);

  // Disk stats from snapshots
  const diskSnaps = await Snapshot.find({ ...snapshotFilter, service: "local_disk" }).lean();
  const lastDiskSnap = diskSnaps[diskSnaps.length - 1];
  const diskMetrics = (lastDiskSnap?.metrics ?? {}) as Record<string, number>;

  // Redis stats from snapshots
  const redisSnaps = await Snapshot.find({ ...snapshotFilter, service: "redis" }).lean();
  const lastRedisSnap = redisSnaps[redisSnaps.length - 1];
  const redisMetrics = (lastRedisSnap?.metrics ?? {}) as Record<string, number>;
  const redisMaxClients = redisSnaps.map((s) => (s.metrics as Record<string, number>).connected_clients ?? 0);
  const redisMaxQueueDepth = redisSnaps.map((s) => (s.metrics as Record<string, number>).total_queue_depth ?? 0);

  // Cost events for token counts
  const billingDay = dayStart.toISOString().slice(0, 10);
  const costMatch: Record<string, unknown> = { billing_day: billingDay };
  if (college_id) costMatch.college_id = college_id;

  const [anthropicCosts] = await CostEvent.aggregate([
    { $match: { ...costMatch, service: "anthropic" } },
    {
      $group: {
        _id: null,
        total_tokens: { $sum: "$total_tokens" },
        count: { $sum: 1 },
        errors: { $sum: { $cond: [{ $eq: ["$error", true] }, 1, 0] } },
      },
    },
  ]);
  const [openaiCosts] = await CostEvent.aggregate([
    { $match: { ...costMatch, service: "openai_embeddings" } },
    {
      $group: {
        _id: null,
        total_tokens: { $sum: "$embedding_tokens" },
        count: { $sum: 1 },
      },
    },
  ]);

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);

  return {
    mongo_storage_gb: mongoMetrics.storage_gb ?? 0,
    mongo_document_count: mongoMetrics.document_count ?? 0,
    mongo_avg_query_latency_ms: avg(mongoLatencies),
    mongo_peak_connections: max(mongoConnections),

    anthropic_total_tokens: (anthropicCosts?.total_tokens as number) ?? 0,
    anthropic_requests: (anthropicCosts?.count as number) ?? 0,
    anthropic_errors: (anthropicCosts?.errors as number) ?? 0,
    anthropic_avg_latency_ms: avg(anthropicLatencies),
    anthropic_haiku_tokens: anthropicMetrics.haiku_tokens_month ?? 0,
    anthropic_sonnet_tokens: anthropicMetrics.sonnet_tokens_month ?? 0,

    openai_total_tokens: (openaiCosts?.total_tokens as number) ?? 0,
    openai_requests: (openaiCosts?.count as number) ?? 0,
    openai_errors: 0,
    openai_avg_latency_ms: avg(openaiLatencies),

    pinecone_vector_count: pineconeMetrics.total_vectors ?? 0,
    pinecone_storage_gb: pineconeMetrics.storage_gb ?? 0,
    pinecone_read_units: pineconeMetrics.ru_read_today ?? 0,
    pinecone_write_units: pineconeMetrics.ru_write_today ?? 0,
    pinecone_avg_query_latency_ms: avg(pineconeLatencies),

    disk_used_gb: diskMetrics.disk_used_gb ?? 0,
    disk_free_gb: diskMetrics.disk_free_gb ?? 0,
    disk_used_pct: diskMetrics.disk_used_pct ?? 0,

    redis_memory_mb: redisMetrics.memory_used_mb ?? 0,
    redis_peak_clients: max(redisMaxClients),
    redis_queue_peak_depth: max(redisMaxQueueDepth),
  };
}

async function buildCollegeRollup(
  Snapshot: ReturnType<typeof getServiceSnapshotModel>,
  CostEvent: ReturnType<typeof getCostEventModel>,
  dayStart: Date,
  dayEnd: Date,
  collegeId: string,
) {
  const billingDay = dayStart.toISOString().slice(0, 10);

  // College-specific MongoDB snapshot
  const mongoSnap = await Snapshot.findOne({
    service: "mongodb",
    snapshot_type: "college",
    college_id: collegeId,
    captured_at: { $gte: dayStart, $lte: dayEnd },
  })
    .sort({ captured_at: -1 })
    .lean();
  const mongoMetrics = (mongoSnap?.metrics ?? {}) as Record<string, number>;

  const [anthropicCosts] = await CostEvent.aggregate([
    { $match: { college_id: collegeId, billing_day: billingDay, service: "anthropic" } },
    { $group: { _id: null, total_tokens: { $sum: "$total_tokens" }, count: { $sum: 1 } } },
  ]);
  const [openaiCosts] = await CostEvent.aggregate([
    { $match: { college_id: collegeId, billing_day: billingDay, service: "openai_embeddings" } },
    { $group: { _id: null, total_tokens: { $sum: "$embedding_tokens" }, count: { $sum: 1 } } },
  ]);

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {
    mongo_storage_gb: mongoMetrics.storage_gb ?? 0,
    mongo_document_count: mongoMetrics.document_count ?? 0,
    mongo_avg_query_latency_ms: 0,
    mongo_peak_connections: 0,

    anthropic_total_tokens: (anthropicCosts?.total_tokens as number) ?? 0,
    anthropic_requests: (anthropicCosts?.count as number) ?? 0,
    anthropic_errors: 0,
    anthropic_avg_latency_ms: 0,
    anthropic_haiku_tokens: 0,
    anthropic_sonnet_tokens: 0,

    openai_total_tokens: (openaiCosts?.total_tokens as number) ?? 0,
    openai_requests: (openaiCosts?.count as number) ?? 0,
    openai_errors: 0,
    openai_avg_latency_ms: 0,

    pinecone_vector_count: 0,
    pinecone_storage_gb: 0,
    pinecone_read_units: 0,
    pinecone_write_units: 0,
    pinecone_avg_query_latency_ms: 0,

    disk_used_gb: 0,
    disk_free_gb: 0,
    disk_used_pct: 0,

    redis_memory_mb: 0,
    redis_peak_clients: 0,
    redis_queue_peak_depth: 0,
  };
}
