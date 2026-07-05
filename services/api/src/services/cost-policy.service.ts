import { getRedisConnection } from "./queue.service";
import { getCostPolicyModel, type CostPolicy } from "../models/platform/cost-policy.model";
import { getMonthlyTokenUsage, getMonthlyCostUsd, getBillingMonth } from "./metering.service";

const POLICY_CACHE_TTL = 60; // 60s — policies change rarely, but bust on save

export interface ResolvedPolicy {
  llm_token_limit_per_month: number;
  llm_token_soft_warn_pct: number;
  llm_token_hard_stop: boolean;
  max_chat_queries_per_student_per_day: number;
  max_ai_summaries_per_student_per_day: number;
  max_exam_gen_per_student_per_day: number;
  allowed_llm_models: string[];
  embedding_model: string;
  cost_budget_usd_per_month: number;
  cost_soft_warn_pct: number;
  storage_limit_gb: number;
}

const GLOBAL_DEFAULTS: ResolvedPolicy = {
  llm_token_limit_per_month:          Number(process.env.DEFAULT_TOKEN_LIMIT_PER_MONTH   ?? 5_000_000),
  llm_token_soft_warn_pct:            80,
  llm_token_hard_stop:                true,
  max_chat_queries_per_student_per_day: Number(process.env.DEFAULT_MAX_CHATS_PER_STUDENT_PER_DAY    ?? 50),
  max_ai_summaries_per_student_per_day: Number(process.env.DEFAULT_MAX_SUMMARIES_PER_STUDENT_PER_DAY ?? 10),
  max_exam_gen_per_student_per_day:     Number(process.env.DEFAULT_MAX_EXAM_GEN_PER_STUDENT_PER_DAY  ?? 5),
  allowed_llm_models:                 ["claude-haiku-4-5-20251001"],
  embedding_model:                    "text-embedding-3-small",
  cost_budget_usd_per_month:          Number(process.env.DEFAULT_COST_BUDGET_USD ?? 50),
  cost_soft_warn_pct:                 75,
  storage_limit_gb:                   Number(process.env.DEFAULT_STORAGE_LIMIT_GB ?? 50),
};

async function fetchPolicy(targetType: string, targetId: string): Promise<CostPolicy | null> {
  const CostPolicy = getCostPolicyModel();
  return CostPolicy.findOne({ target_type: targetType, target_id: targetId }).lean();
}

export async function resolvePolicy(collegeId: string, deptId: string | null): Promise<ResolvedPolicy> {
  const redis = getRedisConnection();
  const cacheKey = `policy:${collegeId}:${deptId ?? "ALL"}`;

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as ResolvedPolicy;

  const [globalPolicy, collegePolicy, deptPolicy] = await Promise.all([
    fetchPolicy("global", "global"),
    fetchPolicy("college", collegeId),
    deptId ? fetchPolicy("dept", deptId) : Promise.resolve(null),
  ]);

  function pick<K extends keyof ResolvedPolicy>(key: K): ResolvedPolicy[K] {
    return (
      (deptPolicy?.[key] as ResolvedPolicy[K]) ??
      (collegePolicy?.[key] as ResolvedPolicy[K]) ??
      (globalPolicy?.[key] as ResolvedPolicy[K]) ??
      GLOBAL_DEFAULTS[key]
    );
  }

  const resolved: ResolvedPolicy = {
    llm_token_limit_per_month:            pick("llm_token_limit_per_month"),
    llm_token_soft_warn_pct:              pick("llm_token_soft_warn_pct"),
    llm_token_hard_stop:                  pick("llm_token_hard_stop"),
    max_chat_queries_per_student_per_day: pick("max_chat_queries_per_student_per_day"),
    max_ai_summaries_per_student_per_day: pick("max_ai_summaries_per_student_per_day"),
    max_exam_gen_per_student_per_day:     pick("max_exam_gen_per_student_per_day"),
    allowed_llm_models:                   pick("allowed_llm_models"),
    embedding_model:                      pick("embedding_model"),
    cost_budget_usd_per_month:            pick("cost_budget_usd_per_month"),
    cost_soft_warn_pct:                   pick("cost_soft_warn_pct"),
    storage_limit_gb:                     pick("storage_limit_gb"),
  };

  await redis.setex(cacheKey, POLICY_CACHE_TTL, JSON.stringify(resolved));
  return resolved;
}

export async function bustPolicyCache(collegeId: string, deptId?: string | null): Promise<void> {
  const redis = getRedisConnection();
  const keys = [`policy:${collegeId}:ALL`];
  if (deptId) keys.push(`policy:${collegeId}:${deptId}`);
  // Also bust global since it affects all
  if (collegeId === "global") {
    // Cannot efficiently bust all — just let TTL expire (60s is acceptable)
    return;
  }
  await redis.del(...keys);
}

export class CostLimitError extends Error {
  constructor(public readonly code: string, public readonly meta: Record<string, unknown> = {}) {
    super(code);
    this.name = "CostLimitError";
  }
}

export class RateLimitError extends Error {
  constructor(public readonly code: string, public readonly meta: Record<string, unknown> = {}) {
    super(code);
    this.name = "RateLimitError";
  }
}

function today(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export async function enforceCostPolicy(
  collegeId: string,
  deptId: string,
  studentId: string | null,
  requestedModel: string,
  actionType: "chat" | "summary" | "exam" = "chat",
): Promise<ResolvedPolicy> {
  const policy = await resolvePolicy(collegeId, deptId);
  const redis = getRedisConnection();

  // 1. Model allowed
  if (!policy.allowed_llm_models.includes(requestedModel)) {
    throw new CostLimitError("MODEL_NOT_PERMITTED", { model: requestedModel });
  }

  // 2. College monthly token hard stop
  if (policy.llm_token_hard_stop) {
    const collegeTokens = await getMonthlyTokenUsage(collegeId, null);
    if (collegeTokens >= policy.llm_token_limit_per_month) {
      throw new CostLimitError("COLLEGE_TOKEN_LIMIT_REACHED", {
        used: collegeTokens,
        limit: policy.llm_token_limit_per_month,
      });
    }
  }

  // 3. Dept monthly token hard stop (only if dept has its own policy)
  const deptPolicy = await fetchPolicy("dept", deptId);
  if (deptPolicy?.llm_token_limit_per_month && policy.llm_token_hard_stop) {
    const deptTokens = await getMonthlyTokenUsage(collegeId, deptId);
    if (deptTokens >= deptPolicy.llm_token_limit_per_month) {
      throw new CostLimitError("DEPT_TOKEN_LIMIT_REACHED", {
        used: deptTokens,
        limit: deptPolicy.llm_token_limit_per_month,
      });
    }
  }

  // 4. Student daily rate limits (Redis incr)
  if (studentId) {
    const limitMap = {
      chat:    policy.max_chat_queries_per_student_per_day,
      summary: policy.max_ai_summaries_per_student_per_day,
      exam:    policy.max_exam_gen_per_student_per_day,
    };
    const actionKey = { chat: "chat", summary: "summ", exam: "exam" }[actionType];
    const rlKey = `rl:${actionKey}:${studentId}:${today()}`;
    const count = await redis.incr(rlKey);
    if (count === 1) await redis.expire(rlKey, 86400);
    if (count > limitMap[actionType]) {
      throw new RateLimitError("STUDENT_DAILY_LIMIT_REACHED", {
        action: actionType,
        limit: limitMap[actionType],
      });
    }
  }

  // 5. Cost budget hard stop — scoped to the dept if a dept-level budget is set,
  // otherwise college-wide. Without this, a dept override would be compared against
  // the whole college's spend, making a tight per-dept budget meaningless.
  if (policy.llm_token_hard_stop) {
    const budgetScopeDeptId = deptPolicy?.cost_budget_usd_per_month != null ? deptId : null;
    const monthlyCost = await getMonthlyCostUsd(collegeId, undefined, budgetScopeDeptId);
    if (monthlyCost >= policy.cost_budget_usd_per_month) {
      throw new CostLimitError(
        budgetScopeDeptId ? "DEPT_BUDGET_EXCEEDED" : "COLLEGE_BUDGET_EXCEEDED",
        { cost: monthlyCost },
      );
    }

    // 6. Soft warning (async — don't block)
    const budgetUtil = monthlyCost / policy.cost_budget_usd_per_month;
    if (budgetUtil >= policy.cost_soft_warn_pct / 100) {
      setImmediate(() => queueSoftWarningAlert(collegeId, "cost_budget", budgetUtil));
    }
  }

  return policy;
}

function queueSoftWarningAlert(collegeId: string, _type: string, _value: number): void {
  // Alert evaluation cron handles creating the alert document.
  // This just logs for immediate visibility.
  console.warn(`[cost-policy] soft warning: college=${collegeId} type=${_type} value=${(_value * 100).toFixed(1)}%`);
}
