import { getRedisConnection } from "../../services/queue.service";
import { getCostEventModel } from "../../models/platform/cost-event.model";
import { getBillingMonth, getBillingDay } from "../../services/metering.service";
import { computeHealth } from "./health";
import { saveSnapshot } from "./snapshot.helper";
import { fireAlert, checkAlertResolution, detectSpike } from "./alert.helper";

export async function runAnthropicProbe(): Promise<void> {
  const probeStart = Date.now();

  try {
    const redis = getRedisConnection();
    const now = Date.now();
    const window60s = now - 60000;

    // RPM: count timestamps in sorted set within last 60s
    const recentRequests = await redis.zrangebyscore("anthropic:rpm_window", window60s, now);
    const rpm = recentRequests.length;

    const tpmIn = parseInt((await redis.get("anthropic:tpm_in_window")) || "0");
    const tpmOut = parseInt((await redis.get("anthropic:tpm_out_window")) || "0");

    const errors1h = parseInt((await redis.get("anthropic:errors_1h")) || "0");
    const total1h = parseInt((await redis.get("anthropic:total_requests_1h")) || "1");
    const errorRate = (errors1h / Math.max(total1h, 1)) * 100;

    const latencyP50 = parseInt((await redis.get("anthropic:latency_p50_ms")) || "0");
    const latencyP95 = parseInt((await redis.get("anthropic:latency_p95_ms")) || "0");

    const lastErrorAt = await redis.get("anthropic:last_error_at");
    const lastErrorCode = await redis.get("anthropic:last_error_code");

    // Monthly from cost_events
    const billingMonth = getBillingMonth();
    const CostEvent = getCostEventModel();
    const monthlyUsage = await CostEvent.aggregate([
      { $match: { service: "anthropic", billing_month: billingMonth } },
      {
        $group: {
          _id: null,
          total_input: { $sum: "$input_tokens" },
          total_output: { $sum: "$output_tokens" },
          haiku_tokens: {
            $sum: {
              $cond: [
                { $eq: ["$model", process.env.LLM_MODEL_CHAT || "claude-haiku-4-5-20251001"] },
                "$total_tokens",
                0,
              ],
            },
          },
          sonnet_tokens: {
            $sum: {
              $cond: [
                { $eq: ["$model", process.env.LLM_MODEL_EXAM || "claude-sonnet-4-6"] },
                "$total_tokens",
                0,
              ],
            },
          },
        },
      },
    ]);

    const m = monthlyUsage[0] || { total_input: 0, total_output: 0, haiku_tokens: 0, sonnet_tokens: 0 };
    const monthlyTokenLimit = parseInt(process.env.ANTHROPIC_MONTHLY_TOKEN_LIMIT || "100000000");
    const monthlyTokensUsed = (m.total_input as number) + (m.total_output as number);
    const quotaRemainingPct = ((monthlyTokenLimit - monthlyTokensUsed) / monthlyTokenLimit) * 100;

    const rpmLimit = parseInt(process.env.ANTHROPIC_RPM_LIMIT || "60");

    const metrics = {
      rpm,
      rpm_limit: rpmLimit,
      rpm_vs_limit_pct: (rpm / rpmLimit) * 100,
      tpm_input: tpmIn,
      tpm_output: tpmOut,
      error_rate_pct: errorRate,
      errors_last_1h: errors1h,
      latency_p50_ms: latencyP50,
      latency_p95_ms: latencyP95,
      last_error_code: lastErrorCode ?? null,
      last_error_at: lastErrorAt ? new Date(parseInt(lastErrorAt)).toISOString() : null,
      monthly_tokens_used: monthlyTokensUsed,
      monthly_token_limit: monthlyTokenLimit,
      quota_remaining_pct: quotaRemainingPct,
      haiku_tokens_month: m.haiku_tokens as number,
      sonnet_tokens_month: m.sonnet_tokens as number,
    };

    const { status, reasons } = computeHealth("anthropic", {
      error_rate_pct: errorRate,
      rpm_vs_limit_pct: metrics.rpm_vs_limit_pct,
      avg_latency_ms: latencyP50,
      quota_remaining_pct: quotaRemainingPct,
    });

    await saveSnapshot({
      service: "anthropic",
      snapshot_type: "platform",
      college_id: null,
      dept_id: null,
      metrics,
      health_status: status,
      health_reasons: reasons,
      probe_duration_ms: Date.now() - probeStart,
    });

    await checkAlertResolution("anthropic", status);

    // Rate limit alert if 429 fired within last 5 minutes
    if (lastErrorCode === "429" && lastErrorAt) {
      const errorAge = now - parseInt(lastErrorAt);
      if (errorAge < 300000) {
        await fireAlert({
          alert_type: "anthropic_rate_limit_hit",
          severity: "warning",
          service: "anthropic",
          title: "Anthropic API rate limit hit",
          message: `Claude API returned HTTP 429 ${Math.round(errorAge / 60000)} min ago. RPM: ${rpm}/${rpmLimit}`,
          metric_name: "rpm_vs_limit_pct",
          metric_value: metrics.rpm_vs_limit_pct,
          threshold_value: 100,
          unit: "%",
        });
      }
    }

    if (quotaRemainingPct <= 5) {
      await fireAlert({
        alert_type: "anthropic_quota_low",
        severity: "critical",
        service: "anthropic",
        title: "Anthropic monthly token quota critically low",
        message: `Only ${quotaRemainingPct.toFixed(1)}% of monthly ${monthlyTokenLimit.toLocaleString()} token limit remains.`,
        metric_name: "quota_remaining_pct",
        metric_value: quotaRemainingPct,
        threshold_value: 5,
        unit: "%",
      });
    } else if (quotaRemainingPct <= 20) {
      await fireAlert({
        alert_type: "anthropic_quota_low",
        severity: "warning",
        service: "anthropic",
        title: "Anthropic monthly token quota low",
        message: `${quotaRemainingPct.toFixed(1)}% of monthly token limit remains.`,
        metric_name: "quota_remaining_pct",
        metric_value: quotaRemainingPct,
        threshold_value: 20,
        unit: "%",
      });
    }

    await detectSpike("anthropic", rpm, "rpm");
  } catch (err) {
    console.error("[anthropic.probe] failed:", err);
  }
}

// Called by llm.service.ts after every Anthropic API call
export async function updateAnthropicMetrics(
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  success: boolean,
  errorCode?: number,
): Promise<void> {
  try {
    const redis = getRedisConnection();
    const now = Date.now();
    const pipe = redis.pipeline();

    pipe.zadd("anthropic:rpm_window", now, String(now));
    pipe.zremrangebyscore("anthropic:rpm_window", "-inf", now - 60000);
    pipe.expire("anthropic:rpm_window", 120);

    pipe.incrby("anthropic:tpm_in_window", inputTokens);
    pipe.incrby("anthropic:tpm_out_window", outputTokens);
    pipe.expire("anthropic:tpm_in_window", 60);
    pipe.expire("anthropic:tpm_out_window", 60);

    const todayKey = `anthropic:total_requests:${getBillingDay()}`;
    pipe.incr(todayKey);
    pipe.expire(todayKey, 172800);

    const hour1Key = "anthropic:total_requests_1h";
    pipe.incr(hour1Key);
    pipe.expire(hour1Key, 3600);

    if (!success) {
      pipe.incr("anthropic:errors_1h");
      pipe.expire("anthropic:errors_1h", 3600);
      pipe.set("anthropic:last_error_at", String(now), "EX", 86400);
      pipe.set("anthropic:last_error_code", String(errorCode ?? 500), "EX", 86400);
    }

    pipe.lpush("anthropic:latency_samples", latencyMs);
    pipe.ltrim("anthropic:latency_samples", 0, 99);

    await pipe.exec();

    setImmediate(async () => {
      try {
        const samples = await redis.lrange("anthropic:latency_samples", 0, -1);
        const sorted = samples.map(Number).sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        await redis.mset("anthropic:latency_p50_ms", p50, "anthropic:latency_p95_ms", p95);
      } catch { /* ignore */ }
    });
  } catch (err) {
    console.error("[updateAnthropicMetrics] failed:", err);
  }
}
