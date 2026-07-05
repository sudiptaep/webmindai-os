import { getRedisConnection } from "./queue.service";
import { getCostEventModel, type CostEvent, type CostEventService } from "../models/platform/cost-event.model";
import { getRateTableModel, type RateTableEntry } from "../models/platform/rate-table.model";

const RATE_CACHE_TTL = 86400; // 24h

export function getBillingMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function getBillingDay(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function recordCostEvent(event: Omit<CostEvent, "_id">): void {
  setImmediate(async () => {
    try {
      const CostEvent = getCostEventModel();
      await CostEvent.create(event);
    } catch (err) {
      console.error("[metering] failed to record cost event:", err);
    }
  });
}

export async function getRateTable(service: CostEventService, model: string): Promise<RateTableEntry> {
  const redis = getRedisConnection();
  const cacheKey = `rate:${service}:${model}`;

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as RateTableEntry;

  const RateTable = getRateTableModel();
  const entry = await RateTable.findOne({ service, model }).lean();
  if (!entry) {
    return {
      _id: "",
      service,
      model,
      input_token_cost_per_1k: 0,
      output_token_cost_per_1k: 0,
      per_unit_cost: 0,
      storage_cost_per_gb_per_month: 0,
      effective_from: new Date(),
      updated_at: new Date(),
    };
  }

  await redis.setex(cacheKey, RATE_CACHE_TTL, JSON.stringify(entry));
  return entry as RateTableEntry;
}

export async function getMonthlyTokenUsage(
  collegeId: string,
  deptId: string | null,
  billingMonth?: string,
): Promise<number> {
  const month = billingMonth ?? getBillingMonth();
  const CostEvent = getCostEventModel();

  const match: Record<string, unknown> = {
    college_id: collegeId,
    billing_month: month,
    service: "anthropic",
  };
  if (deptId) match.dept_id = deptId;

  const [result] = await CostEvent.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$total_tokens" } } },
  ]);

  return result?.total ?? 0;
}

export async function getMonthlyCostUsd(
  collegeId: string,
  billingMonth?: string,
  deptId?: string | null,
): Promise<number> {
  const month = billingMonth ?? getBillingMonth();
  const CostEvent = getCostEventModel();

  const match: Record<string, unknown> = { college_id: collegeId, billing_month: month };
  if (deptId) match.dept_id = deptId;

  const [result] = await CostEvent.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$cost_usd" } } },
  ]);

  return result?.total ?? 0;
}

export async function getDailyCostUsd(collegeId: string, billingDay: string): Promise<number> {
  const CostEvent = getCostEventModel();
  const [result] = await CostEvent.aggregate([
    { $match: { college_id: collegeId, billing_day: billingDay } },
    { $group: { _id: null, total: { $sum: "$cost_usd" } } },
  ]);
  return result?.total ?? 0;
}

export async function get7DayRollingAvgCost(collegeId: string): Promise<number> {
  const CostEvent = getCostEventModel();
  const now = new Date();
  const days: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    days.push(`${y}-${m}-${day}`);
  }

  const [result] = await CostEvent.aggregate([
    { $match: { college_id: collegeId, billing_day: { $in: days } } },
    { $group: { _id: "$billing_day", daily: { $sum: "$cost_usd" } } },
    { $group: { _id: null, avg: { $avg: "$daily" } } },
  ]);

  return result?.avg ?? 0;
}
