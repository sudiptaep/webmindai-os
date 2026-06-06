import { getRedisConnection } from "../../services/queue.service";
import { getCostEventModel } from "../../models/platform/cost-event.model";
import { getBillingMonth, getBillingDay } from "../../services/metering.service";
import { computeHealth } from "./health";
import { saveSnapshot } from "./snapshot.helper";
import { fireAlert, checkAlertResolution, detectSpike } from "./alert.helper";

export async function runOpenAIProbe(): Promise<void> {
  const probeStart = Date.now();

  try {
    const redis = getRedisConnection();
    const now = Date.now();
    const window60s = now - 60000;

    const recentRequests = await redis.zrangebyscore("openai:rpm_window", window60s, now);
    const rpm = recentRequests.length;
    const tpm = parseInt((await redis.get("openai:tpm_window")) || "0");

    const errors1h = parseInt((await redis.get("openai:errors_1h")) || "0");
    const total1h = parseInt((await redis.get("openai:total_requests_1h")) || "1");
    const errorRate = (errors1h / Math.max(total1h, 1)) * 100;

    const latencyP50 = parseInt((await redis.get("openai:latency_p50_ms")) || "0");
    const latencyP95 = parseInt((await redis.get("openai:latency_p95_ms")) || "0");

    const lastErrorAt = await redis.get("openai:last_error_at");
    const lastErrorCode = await redis.get("openai:last_error_code");

    const today = getBillingDay();
    const ingestTokensToday = parseInt((await redis.get(`openai:ingest_tokens:${today}`)) || "0");
    const queryTokensToday = parseInt((await redis.get(`openai:query_tokens:${today}`)) || "0");

    const billingMonth = getBillingMonth();
    const CostEvent = getCostEventModel();
    const monthlyUsage = await CostEvent.aggregate([
      { $match: { service: "openai_embeddings", billing_month: billingMonth } },
      {
        $group: {
          _id: "$action_type",
          total_tokens: { $sum: "$embedding_tokens" },
        },
      },
    ]);

    let monthlyIngestionTokens = 0;
    let monthlyQueryTokens = 0;
    for (const row of monthlyUsage) {
      if ((row._id as string) === "doc_ingestion") monthlyIngestionTokens = row.total_tokens as number;
      if ((row._id as string) === "query_embedding") monthlyQueryTokens = row.total_tokens as number;
    }
    const monthlyTokensUsed = monthlyIngestionTokens + monthlyQueryTokens;
    const monthlyTokenLimit = parseInt(process.env.OPENAI_MONTHLY_TOKEN_LIMIT || "500000000");
    const quotaRemainingPct = ((monthlyTokenLimit - monthlyTokensUsed) / monthlyTokenLimit) * 100;

    const rpmLimit = parseInt(process.env.OPENAI_RPM_LIMIT || "3000");

    const metrics = {
      rpm,
      rpm_limit: rpmLimit,
      rpm_vs_limit_pct: (rpm / rpmLimit) * 100,
      tpm,
      error_rate_pct: errorRate,
      errors_last_1h: errors1h,
      latency_p50_ms: latencyP50,
      latency_p95_ms: latencyP95,
      last_error_code: lastErrorCode ?? null,
      ingest_tokens_today: ingestTokensToday,
      query_tokens_today: queryTokensToday,
      monthly_tokens_used: monthlyTokensUsed,
      monthly_ingestion_tokens: monthlyIngestionTokens,
      monthly_query_tokens: monthlyQueryTokens,
      monthly_token_limit: monthlyTokenLimit,
      quota_remaining_pct: quotaRemainingPct,
    };

    const { status, reasons } = computeHealth("openai", {
      error_rate_pct: errorRate,
      rpm_vs_limit_pct: metrics.rpm_vs_limit_pct,
      avg_latency_ms: latencyP50,
      quota_remaining_pct: quotaRemainingPct,
    });

    await saveSnapshot({
      service: "openai_embeddings",
      snapshot_type: "platform",
      college_id: null,
      dept_id: null,
      metrics,
      health_status: status,
      health_reasons: reasons,
      probe_duration_ms: Date.now() - probeStart,
    });

    await checkAlertResolution("openai_embeddings", status);

    if (lastErrorCode === "429" && lastErrorAt) {
      const errorAge = now - parseInt(lastErrorAt);
      if (errorAge < 300000) {
        await fireAlert({
          alert_type: "openai_rate_limit_hit",
          severity: "warning",
          service: "openai_embeddings",
          title: "OpenAI Embeddings rate limit hit",
          message: `Embeddings API returned HTTP 429 ${Math.round(errorAge / 60000)} min ago. RPM: ${rpm}/${rpmLimit}`,
          metric_name: "rpm_vs_limit_pct",
          metric_value: metrics.rpm_vs_limit_pct,
          threshold_value: 100,
          unit: "%",
        });
      }
    }

    if (quotaRemainingPct <= 20) {
      await fireAlert({
        alert_type: "openai_quota_low",
        severity: quotaRemainingPct <= 5 ? "critical" : "warning",
        service: "openai_embeddings",
        title: "OpenAI monthly token quota low",
        message: `${quotaRemainingPct.toFixed(1)}% of monthly ${monthlyTokenLimit.toLocaleString()} token limit remains.`,
        metric_name: "quota_remaining_pct",
        metric_value: quotaRemainingPct,
        threshold_value: 20,
        unit: "%",
      });
    }

    await detectSpike("openai_embeddings", tpm, "tpm");
  } catch (err) {
    console.error("[openai.probe] failed:", err);
  }
}

// Called by embedding.service.ts after every OpenAI embedding call
export async function updateOpenAIMetrics(
  tokens: number,
  latencyMs: number,
  actionType: "doc_ingestion" | "query_embedding",
  success: boolean,
  errorCode?: number,
): Promise<void> {
  try {
    const redis = getRedisConnection();
    const now = Date.now();
    const pipe = redis.pipeline();

    pipe.zadd("openai:rpm_window", now, String(now));
    pipe.zremrangebyscore("openai:rpm_window", "-inf", now - 60000);
    pipe.expire("openai:rpm_window", 120);

    pipe.incrby("openai:tpm_window", tokens);
    pipe.expire("openai:tpm_window", 60);

    const todayKey = `openai:total_requests:${getBillingDay()}`;
    pipe.incr(todayKey);
    pipe.expire(todayKey, 172800);

    pipe.incr("openai:total_requests_1h");
    pipe.expire("openai:total_requests_1h", 3600);

    // Track ingest vs query split
    const splitKey = actionType === "doc_ingestion"
      ? `openai:ingest_tokens:${getBillingDay()}`
      : `openai:query_tokens:${getBillingDay()}`;
    pipe.incrby(splitKey, tokens);
    pipe.expire(splitKey, 172800);

    if (!success) {
      pipe.incr("openai:errors_1h");
      pipe.expire("openai:errors_1h", 3600);
      pipe.set("openai:last_error_at", String(now), "EX", 86400);
      pipe.set("openai:last_error_code", String(errorCode ?? 500), "EX", 86400);
    }

    pipe.lpush("openai:latency_samples", latencyMs);
    pipe.ltrim("openai:latency_samples", 0, 99);

    await pipe.exec();

    setImmediate(async () => {
      try {
        const samples = await redis.lrange("openai:latency_samples", 0, -1);
        const sorted = samples.map(Number).sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        await redis.mset("openai:latency_p50_ms", p50, "openai:latency_p95_ms", p95);
      } catch { /* ignore */ }
    });
  } catch (err) {
    console.error("[updateOpenAIMetrics] failed:", err);
  }
}
