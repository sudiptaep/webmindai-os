import { z } from "zod";
import { router, superAdminProcedure } from "../trpc";
import { getCollegeModel } from "../../models/platform/college.model";
import { getCollegeDb } from "../../db/college.db";
import { getQueryLogModel } from "../../models/college/query-log.model";

const RERANK_ALERT_THRESHOLD = Number(process.env.RAG_RERANK_ALERT_THRESHOLD ?? 0.55);
const TRUNCATION_ALERT_THRESHOLD_PCT = Number(process.env.LLM_TRUNCATION_ALERT_THRESHOLD_PCT ?? 5);

export const superAdminObservatoryRouter = router({
  // F-18-C: rerank score monitoring across colleges — surfaces silent quality
  // degradation (e.g. after a bad document upload drags a topic area down).
  rerankScores: superAdminProcedure
    .input(z.object({
      college_id: z.string().optional(),
      dept_id: z.string().optional(),
      days: z.number().int().min(1).max(30).default(7),
    }))
    .query(async ({ input }) => {
      const College = getCollegeModel();
      const colleges = input.college_id
        ? [{ _id: input.college_id }]
        : await College.find({ status: "active" }, { _id: 1 }).lean();

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const rows: Array<{
        college_id: string;
        avg_top_score: number;
        avg_score_spread: number;
        query_count: number;
        below_alert_threshold: boolean;
      }> = [];

      for (const college of colleges) {
        const collegeId = String(college._id);
        const conn = await getCollegeDb(collegeId);
        const QueryLog = getQueryLogModel(conn);

        const matchStage: Record<string, unknown> = {
          created_at: { $gte: since },
          rerank_top_score: { $exists: true },
        };
        if (input.dept_id) matchStage.dept_id = input.dept_id;

        const [agg] = await QueryLog.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              avg_top_score: { $avg: "$rerank_top_score" },
              avg_score_spread: { $avg: "$rerank_score_spread" },
              query_count: { $sum: 1 },
            },
          },
        ]);

        if (agg && agg.query_count > 0) {
          rows.push({
            college_id: collegeId,
            avg_top_score: Math.round(agg.avg_top_score * 1000) / 1000,
            avg_score_spread: Math.round(agg.avg_score_spread * 1000) / 1000,
            query_count: agg.query_count,
            below_alert_threshold: agg.avg_top_score < RERANK_ALERT_THRESHOLD,
          });
        }
      }

      return {
        alert_threshold: RERANK_ALERT_THRESHOLD,
        colleges: rows.sort((a, b) => a.avg_top_score - b.avg_top_score),
      };
    }),

  // F-18-D: response truncation rate — validates whether the max_tokens raise
  // + auto-continuation fix is working, broken down by college and question type.
  truncationRate: superAdminProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(7) }))
    .query(async ({ input }) => {
      const College = getCollegeModel();
      const colleges = await College.find({ status: "active" }, { _id: 1 }).lean();

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      let platformTotal = 0;
      let platformTruncated = 0;
      const byCollege: Array<{ college_id: string; truncation_pct: number; query_count: number }> = [];
      const byComplexityAgg = new Map<string, { total: number; truncated: number }>();

      for (const college of colleges) {
        const collegeId = String(college._id);
        const conn = await getCollegeDb(collegeId);
        const QueryLog = getQueryLogModel(conn);

        const [collegeAgg] = await QueryLog.aggregate([
          { $match: { created_at: { $gte: since }, stop_reason: { $exists: true } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              truncated: { $sum: { $cond: ["$was_truncated", 1, 0] } },
            },
          },
        ]);

        if (collegeAgg && collegeAgg.total > 0) {
          platformTotal += collegeAgg.total;
          platformTruncated += collegeAgg.truncated;
          byCollege.push({
            college_id: collegeId,
            truncation_pct: Math.round((collegeAgg.truncated / collegeAgg.total) * 1000) / 10,
            query_count: collegeAgg.total,
          });
        }

        const complexityAgg = await QueryLog.aggregate([
          { $match: { created_at: { $gte: since }, stop_reason: { $exists: true } } },
          {
            $group: {
              _id: "$query_complexity",
              total: { $sum: 1 },
              truncated: { $sum: { $cond: ["$was_truncated", 1, 0] } },
            },
          },
        ]);
        for (const row of complexityAgg) {
          const key = row._id ?? "unknown";
          const existing = byComplexityAgg.get(key) ?? { total: 0, truncated: 0 };
          existing.total += row.total;
          existing.truncated += row.truncated;
          byComplexityAgg.set(key, existing);
        }
      }

      return {
        alert_threshold_pct: TRUNCATION_ALERT_THRESHOLD_PCT,
        platform_wide_pct: platformTotal > 0 ? Math.round((platformTruncated / platformTotal) * 1000) / 10 : 0,
        by_college: byCollege.sort((a, b) => b.truncation_pct - a.truncation_pct),
        by_question_type: [...byComplexityAgg.entries()].map(([query_complexity, v]) => ({
          query_complexity,
          truncation_pct: v.total > 0 ? Math.round((v.truncated / v.total) * 1000) / 10 : 0,
          query_count: v.total,
        })).sort((a, b) => b.truncation_pct - a.truncation_pct),
      };
    }),
});
