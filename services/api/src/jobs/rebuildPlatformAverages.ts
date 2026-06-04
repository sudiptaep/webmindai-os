import { getCostEventModel } from "../models/platform/cost-event.model";
import { getRedisConnection } from "../services/queue.service";
import { getBillingMonth } from "../services/metering.service";

const CACHE_KEY = "platform:averages";
const CACHE_TTL = 86400; // 24h

export interface PlatformAverages {
  avg_tokens_per_chat: number;
  avg_tokens_per_summary: number;
  avg_tokens_per_exam: number;
  avg_cost_per_chat: number;
  avg_cost_per_summary: number;
  avg_cost_per_exam: number;
  computed_at: string;
}

export async function runRebuildPlatformAverages(): Promise<void> {
  const CostEvent = getCostEventModel();
  const redis = getRedisConnection();

  // Use last 2 billing months for sample size
  const now = new Date();
  const thisMonth = getBillingMonth();
  const prevDate = new Date(now);
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prevMonth = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;

  const results = await CostEvent.aggregate([
    { $match: { billing_month: { $in: [thisMonth, prevMonth] } } },
    {
      $group: {
        _id: "$action_type",
        avg_tokens: { $avg: "$total_tokens" },
        avg_cost:   { $avg: "$cost_usd" },
      },
    },
  ]);

  function findAvg(actionType: string, field: "avg_tokens" | "avg_cost", fallback: number): number {
    const row = results.find((r: { _id: string }) => r._id === actionType);
    return (row as Record<string, number> | undefined)?.[field] ?? fallback;
  }

  const averages: PlatformAverages = {
    avg_tokens_per_chat:    findAvg("chat_message",    "avg_tokens", 454),
    avg_tokens_per_summary: findAvg("ai_summary",      "avg_tokens", 820),
    avg_tokens_per_exam:    findAvg("exam_generation",  "avg_tokens", 2000),
    avg_cost_per_chat:      findAvg("chat_message",    "avg_cost",   0.00062),
    avg_cost_per_summary:   findAvg("ai_summary",      "avg_cost",   0.00185),
    avg_cost_per_exam:      findAvg("exam_generation",  "avg_cost",   0.00520),
    computed_at:            new Date().toISOString(),
  };

  await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(averages));
  console.info("[rebuildPlatformAverages] averages rebuilt and cached");
}

export async function getPlatformAverages(): Promise<PlatformAverages> {
  const redis = getRedisConnection();
  const cached = await redis.get(CACHE_KEY);
  if (cached) return JSON.parse(cached) as PlatformAverages;

  // Trigger rebuild on-demand if cache miss (e.g. first boot)
  await runRebuildPlatformAverages();
  const fresh = await redis.get(CACHE_KEY);
  return fresh ? (JSON.parse(fresh) as PlatformAverages) : {
    avg_tokens_per_chat: 454, avg_tokens_per_summary: 820, avg_tokens_per_exam: 2000,
    avg_cost_per_chat: 0.00062, avg_cost_per_summary: 0.00185, avg_cost_per_exam: 0.00520,
    computed_at: new Date().toISOString(),
  };
}
