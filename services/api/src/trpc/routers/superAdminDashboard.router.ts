import { z } from "zod";
import { router, superAdminProcedure } from "../trpc";
import { getMonthlyCostSummaryModel } from "../../models/platform/monthly-cost-summary.model";
import { getCostEventModel } from "../../models/platform/cost-event.model";
import { getAlertModel } from "../../models/platform/alert.model";
import { getCollegeModel } from "../../models/platform/college.model";
import { resolvePolicy } from "../../services/cost-policy.service";
import { getBillingMonth } from "../../services/metering.service";
import { getPlatformAverages } from "../../jobs/rebuildPlatformAverages";

const USD_TO_INR = Number(process.env.USD_TO_INR_RATE ?? 83);
const MARGIN_WARN_PCT = Number(process.env.MARGIN_WARN_PCT ?? 20);
const MARGIN_DANGER_PCT = Number(process.env.MARGIN_DANGER_PCT ?? 40);

function currentMonth(): string {
  return getBillingMonth();
}

export const superAdminDashboardRouter = router({
  getDashboard: superAdminProcedure
    .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }))
    .query(async ({ input }) => {
      const month = input.month ?? currentMonth();
      const Summary = getMonthlyCostSummaryModel();
      const Alert = getAlertModel();
      const CostEvent = getCostEventModel();

      // College-level summaries (dept_id = "ALL")
      const collegeSummaries = await Summary.find({ billing_month: month, dept_id: "ALL" }).lean();

      const platformTotals = collegeSummaries.reduce(
        (acc, s) => ({
          total_cost_usd:   acc.total_cost_usd   + s.total_cost_usd,
          anthropic_cost:   acc.anthropic_cost   + s.anthropic_cost_usd,
          openai_cost:      acc.openai_cost      + s.openai_cost_usd,
          cohere_cost:      acc.cohere_cost      + s.cohere_cost_usd,
          pinecone_cost:    acc.pinecone_cost    + s.pinecone_cost_usd,
          llm_tokens:       acc.llm_tokens       + s.llm_input_tokens + s.llm_output_tokens,
          chat_messages:    acc.chat_messages    + s.chat_message_count,
          unique_students:  acc.unique_students  + s.unique_students,
        }),
        { total_cost_usd: 0, anthropic_cost: 0, openai_cost: 0, cohere_cost: 0, pinecone_cost: 0, llm_tokens: 0, chat_messages: 0, unique_students: 0 },
      );

      // Daily trend for current month (last 31 days)
      const dailyTrend = await CostEvent.aggregate([
        { $match: { billing_month: month } },
        { $group: { _id: "$billing_day", total: { $sum: "$cost_usd" } } },
        { $sort: { _id: 1 } },
      ]);

      const alerts = await Alert.find({ status: "active" }).sort({ severity: -1, updated_at: -1 }).lean();

      return { platform_totals: platformTotals, cost_by_college: collegeSummaries, daily_trend: dailyTrend, alerts };
    }),

  getCollegeCosts: superAdminProcedure
    .input(z.object({ collegeId: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }))
    .query(async ({ input }) => {
      const month = input.month ?? currentMonth();
      const { collegeId } = input;
      const Summary = getMonthlyCostSummaryModel();
      const CostEvent = getCostEventModel();
      const College = getCollegeModel();

      const [collegeSummary, deptSummaries, dailyTrend, college, policy] = await Promise.all([
        Summary.findOne({ billing_month: month, college_id: collegeId, dept_id: "ALL" }).lean(),
        Summary.find({ billing_month: month, college_id: collegeId, dept_id: { $ne: "ALL" } }).lean(),
        CostEvent.aggregate([
          { $match: { college_id: collegeId, billing_month: month } },
          { $group: { _id: "$billing_day", total: { $sum: "$cost_usd" } } },
          { $sort: { _id: 1 } },
        ]),
        College.findById(collegeId).lean(),
        resolvePolicy(collegeId, null),
      ]);

      // Margin calculation — needs plan price from college
      const planPriceInr = (college as unknown as { plan_price_inr?: number })?.plan_price_inr ?? 0;
      const deptCount    = deptSummaries.length;
      const revenueInr   = planPriceInr * deptCount;
      const costInr      = (collegeSummary?.total_cost_usd ?? 0) * USD_TO_INR;
      const marginInr    = revenueInr - costInr;
      const marginPct    = revenueInr > 0 ? (marginInr / revenueInr) * 100 : 0;
      const costRevRatio = revenueInr > 0 ? (costInr / revenueInr) * 100 : 0;

      return {
        totals:        collegeSummary,
        by_dept:       deptSummaries,
        daily_trend:   dailyTrend,
        policy,
        margin: {
          revenue_inr:      revenueInr,
          cost_usd:         collegeSummary?.total_cost_usd ?? 0,
          cost_inr:         costInr,
          margin_inr:       marginInr,
          margin_pct:       marginPct,
          cost_revenue_pct: costRevRatio,
          status:           costRevRatio >= MARGIN_DANGER_PCT ? "danger" : costRevRatio >= MARGIN_WARN_PCT ? "warn" : "ok",
        },
      };
    }),

  getDeptCosts: superAdminProcedure
    .input(z.object({ collegeId: z.string(), deptId: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }))
    .query(async ({ input }) => {
      const month = input.month ?? currentMonth();
      const { collegeId, deptId } = input;
      const Summary = getMonthlyCostSummaryModel();
      const CostEvent = getCostEventModel();

      const [summary, policy, actionBreakdown, serviceBreakdown, topStudents] = await Promise.all([
        Summary.findOne({ billing_month: month, college_id: collegeId, dept_id: deptId }).lean(),
        resolvePolicy(collegeId, deptId),
        CostEvent.aggregate([
          { $match: { college_id: collegeId, dept_id: deptId, billing_month: month } },
          { $group: { _id: "$action_type", total_cost: { $sum: "$cost_usd" }, count: { $sum: 1 } } },
          { $sort: { total_cost: -1 } },
        ]),
        CostEvent.aggregate([
          { $match: { college_id: collegeId, dept_id: deptId, billing_month: month } },
          { $group: { _id: "$service", total_cost: { $sum: "$cost_usd" } } },
          { $sort: { total_cost: -1 } },
        ]),
        CostEvent.aggregate([
          { $match: { college_id: collegeId, dept_id: deptId, billing_month: month, student_id: { $ne: null } } },
          { $group: {
            _id: "$student_id",
            total_tokens: { $sum: "$total_tokens" },
            total_cost:   { $sum: "$cost_usd" },
            chat_count:   { $sum: { $cond: [{ $eq: ["$action_type", "chat_message"] },    1, 0] } },
            summary_count:{ $sum: { $cond: [{ $eq: ["$action_type", "ai_summary"] },      1, 0] } },
            exam_count:   { $sum: { $cond: [{ $eq: ["$action_type", "exam_generation"] }, 1, 0] } },
          }},
          { $sort: { total_tokens: -1 } },
          { $limit: 10 },
        ]),
      ]);

      // Per-query averages (last 100 events for each action type)
      const perQueryAnalysis = await CostEvent.aggregate([
        { $match: { college_id: collegeId, dept_id: deptId, billing_month: month } },
        { $group: {
          _id: "$action_type",
          avg_cost:   { $avg: "$cost_usd" },
          avg_tokens: { $avg: "$total_tokens" },
          avg_in:     { $avg: "$input_tokens" },
          avg_out:    { $avg: "$output_tokens" },
        }},
      ]);

      return { totals: summary, policy, by_action_type: actionBreakdown, by_service: serviceBreakdown, top_students: topStudents, per_query_analysis: perQueryAnalysis };
    }),

  getPlatformAverages: superAdminProcedure.query(async () => {
    return getPlatformAverages();
  }),

  simulateCostPlan: superAdminProcedure
    .input(z.object({
      college_type:       z.enum(["engineering", "medical", "other"]),
      num_depts:          z.number().int().positive(),
      students_per_dept:  z.number().int().positive(),
      active_ratio:       z.number().min(0).max(1),
      price_inr_per_dept: z.number().positive(),
      avg_chats_per_student_per_day: z.number().optional(),
      avg_tokens_per_chat:           z.number().optional(),
      avg_summaries_per_student_per_month: z.number().optional(),
      avg_tokens_per_summary:        z.number().optional(),
      docs_per_dept_per_month:       z.number().optional(),
      avg_pages_per_doc:             z.number().optional(),
      avg_tokens_per_page:           z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const avgs = await getPlatformAverages();
      const {
        num_depts, students_per_dept, active_ratio, price_inr_per_dept,
        avg_chats_per_student_per_day: chatsPerDay = 8,
        avg_tokens_per_chat:           tokensPerChat = avgs.avg_tokens_per_chat,
        avg_summaries_per_student_per_month: summariesPerMonth = 5,
        avg_tokens_per_summary:        tokensPerSummary = avgs.avg_tokens_per_summary,
        docs_per_dept_per_month:       docsPerDept = 3,
        avg_pages_per_doc:             pagesPerDoc = 60,
        avg_tokens_per_page:           tokensPerPage = 380,
      } = input;

      const activeStudents = Math.round(students_per_dept * num_depts * active_ratio);
      const workDays = 25;

      const HAIKU_IN  = Number(process.env.ANTHROPIC_HAIKU_INPUT_COST_PER_1K  ?? 0.00025);
      const HAIKU_OUT = Number(process.env.ANTHROPIC_HAIKU_OUTPUT_COST_PER_1K ?? 0.00125);
      const EMBED     = Number(process.env.OPENAI_EMBEDDING_COST_PER_1K       ?? 0.00002);
      const PINECONE_PER_M_RU = Number(process.env.PINECONE_READ_UNIT_COST_PER_1M ?? 0.096);

      // Assume 60/40 in/out split for Haiku
      const chatInTokens  = tokensPerChat * 0.6;
      const chatOutTokens = tokensPerChat * 0.4;
      const chatLlmCost   = activeStudents * chatsPerDay * workDays *
        (chatInTokens / 1000 * HAIKU_IN + chatOutTokens / 1000 * HAIKU_OUT);

      const summaryLlmCost = activeStudents * summariesPerMonth *
        (tokensPerSummary * 0.6 / 1000 * HAIKU_IN + tokensPerSummary * 0.4 / 1000 * HAIKU_OUT);

      const queryEmbedCost = activeStudents * chatsPerDay * workDays * (tokensPerChat * 0.3 / 1000 * EMBED);
      const ingestEmbedCost = num_depts * docsPerDept * pagesPerDoc * (tokensPerPage / 1000 * EMBED);

      const pineconeQueryCost = activeStudents * chatsPerDay * workDays / 1_000_000 * PINECONE_PER_M_RU;

      const totalCostUsd = chatLlmCost + summaryLlmCost + queryEmbedCost + ingestEmbedCost + pineconeQueryCost;
      const revenueInr = price_inr_per_dept * num_depts;
      const revenueUsd = revenueInr / USD_TO_INR;
      const marginUsd  = revenueUsd - totalCostUsd;
      const marginPct  = revenueUsd > 0 ? (marginUsd / revenueUsd) * 100 : 0;

      const projectedTokens = activeStudents * chatsPerDay * workDays * tokensPerChat
        + activeStudents * summariesPerMonth * tokensPerSummary;
      const recommendedTokenLimit = Math.ceil(projectedTokens * 1.2);

      return {
        active_students:         activeStudents,
        projected_cost_usd:      totalCostUsd,
        cost_per_dept_usd:       totalCostUsd / num_depts,
        cost_per_student_usd:    activeStudents > 0 ? totalCostUsd / activeStudents : 0,
        revenue_inr:             revenueInr,
        revenue_usd:             revenueUsd,
        margin_usd:              marginUsd,
        margin_pct:              marginPct,
        recommended_token_limit: recommendedTokenLimit,
        by_service: {
          anthropic_llm:    chatLlmCost + summaryLlmCost,
          openai_embeddings: queryEmbedCost + ingestEmbedCost,
          pinecone:          pineconeQueryCost,
        },
      };
    }),

  getAlerts: superAdminProcedure
    .input(z.object({ status: z.enum(["active", "resolved"]).optional() }))
    .query(async ({ input }) => {
      const Alert = getAlertModel();
      const filter = input.status ? { status: input.status } : {};
      return Alert.find(filter).sort({ severity: -1, created_at: -1 }).lean();
    }),

  resolveAlert: superAdminProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input }) => {
      const Alert = getAlertModel();
      await Alert.updateOne(
        { _id: input.alertId },
        { $set: { status: "resolved", resolved_at: new Date() } },
      );
      return { ok: true };
    }),
});
