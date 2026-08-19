import { z } from "zod";
import { router, deptAdminProcedure, collegeAdminProcedure } from "../trpc";
import { getDepartmentModel } from "../../models/college/department.model";
import {
  getTeachingAnalytics, getStruggleReport, getMostTaughtConcepts, getBacktrackHotspots,
} from "../../services/teaching-analytics.service";

const daysInput = z.object({ days: z.number().int().min(1).max(180).default(30) });

export const teachingAnalyticsRouter = router({
  // F-20-C §10.5 — most-taught concepts, backtrack hotspots, misconception frequency
  analytics: deptAdminProcedure
    .input(daysInput)
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      return getTeachingAnalytics(conn, ctx.user.dept_id, input.days);
    }),

  // Actionable "cover this in lecture" report
  struggleReport: deptAdminProcedure
    .input(daysInput)
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      return getStruggleReport(conn, ctx.user.dept_id, input.days);
    }),

  // College admin: cross-department teaching analytics (F-16)
  crossDept: collegeAdminProcedure
    .input(daysInput)
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const depts = await getDepartmentModel(conn).find({ deleted: { $ne: true } }).select("_id name").lean();

      const perDept = await Promise.all(
        depts.map(async (dept) => {
          const deptId = String(dept._id);
          const [mostTaught, hotspots] = await Promise.all([
            getMostTaughtConcepts(conn, deptId, input.days),
            getBacktrackHotspots(conn, deptId, input.days),
          ]);
          const totalSessions = mostTaught.reduce((sum, r) => sum + r.sessions, 0);
          const weightedBacktrackRate = totalSessions > 0
            ? mostTaught.reduce((sum, r) => sum + r.backtrack_rate * r.sessions, 0) / totalSessions
            : 0;

          return {
            dept_id: deptId,
            dept_name: dept.name,
            total_sessions: totalSessions,
            concepts_taught: mostTaught.length,
            overall_backtrack_rate: Math.round(weightedBacktrackRate * 1000) / 1000,
            hotspot_count: hotspots.length,
            top_concept: mostTaught[0]?.canonical_name ?? null,
          };
        }),
      );

      return { departments: perDept.sort((a, b) => b.total_sessions - a.total_sessions) };
    }),
});

export type TeachingAnalyticsRouter = typeof teachingAnalyticsRouter;
