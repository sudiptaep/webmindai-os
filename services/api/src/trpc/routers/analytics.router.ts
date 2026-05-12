import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, deptAdminProcedure, superAdminProcedure } from "../trpc";
import { getCollegeDb } from "../../db/college.db";
import { getQueryLogModel } from "../../models/college/query-log.model";
import { getDocumentModel } from "../../models/college/document.model";
import { getStudentModel } from "../../models/college/student.model";
import { UNANSWERED_CLUSTER_THRESHOLD, UNANSWERED_CLUSTER_WINDOW_HOURS } from "@college-chatbot/shared";

export const analyticsRouter = router({
  // Query volume per day — last N days
  queryVolume: deptAdminProcedure
    .input(
      z.object({
        dept_id: z.string().optional(),
        days: z.number().int().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const collegeId = ctx.user.college_id;

      const deptFilter: string[] = [];
      if (input.dept_id) {
        if (!ctx.user.is_college_owner && !ctx.user.dept_ids.includes(input.dept_id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
        }
        deptFilter.push(input.dept_id);
      } else {
        if (!ctx.user.is_college_owner) {
          deptFilter.push(...ctx.user.dept_ids);
        }
      }

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const conn = await getCollegeDb(collegeId);
      const QueryLog = getQueryLogModel(conn);

      const matchStage: Record<string, unknown> = {
        college_id: collegeId,
        created_at: { $gte: since },
      };
      if (deptFilter.length > 0) matchStage.dept_id = { $in: deptFilter };

      const result = await QueryLog.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
            },
            total: { $sum: 1 },
            answered: { $sum: { $cond: ["$answered", 1, 0] } },
            unanswered: { $sum: { $cond: ["$answered", 0, 1] } },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { date: "$_id", total: 1, answered: 1, unanswered: 1, _id: 0 } },
      ]);

      return result as Array<{ date: string; total: number; answered: number; unanswered: number }>;
    }),

  // Unanswered queries flagged to admin
  unansweredQueue: deptAdminProcedure
    .input(
      z.object({
        dept_id: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const collegeId = ctx.user.college_id;

      const deptFilter: string[] = [];
      if (input.dept_id) {
        if (!ctx.user.is_college_owner && !ctx.user.dept_ids.includes(input.dept_id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
        }
        deptFilter.push(input.dept_id);
      } else {
        if (!ctx.user.is_college_owner) {
          deptFilter.push(...ctx.user.dept_ids);
        }
      }

      const conn = await getCollegeDb(collegeId);
      const QueryLog = getQueryLogModel(conn);

      const filter: Record<string, unknown> = {
        college_id: collegeId,
        answered: false,
        flagged_to_admin: true,
      };
      if (deptFilter.length > 0) filter.dept_id = { $in: deptFilter };

      const skip = (input.page - 1) * input.limit;
      const [queries, total] = await Promise.all([
        QueryLog.find(filter as never).sort({ created_at: -1 }).skip(skip).limit(input.limit).lean(),
        QueryLog.countDocuments(filter as never),
      ]);

      return { queries, total, page: input.page, limit: input.limit };
    }),

  // Common unanswered topics (cluster by query text similarity — naive grouping by day/dept here)
  topics: deptAdminProcedure
    .input(
      z.object({
        dept_id: z.string().optional(),
        hours: z.number().int().min(1).max(168).default(UNANSWERED_CLUSTER_WINDOW_HOURS),
      }),
    )
    .query(async ({ ctx, input }) => {
      const collegeId = ctx.user.college_id;

      const deptFilter: string[] = [];
      if (input.dept_id) {
        if (!ctx.user.is_college_owner && !ctx.user.dept_ids.includes(input.dept_id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
        }
        deptFilter.push(input.dept_id);
      } else {
        if (!ctx.user.is_college_owner) {
          deptFilter.push(...ctx.user.dept_ids);
        }
      }

      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);

      const conn = await getCollegeDb(collegeId);
      const QueryLog = getQueryLogModel(conn);

      const matchStage: Record<string, unknown> = {
        college_id: collegeId,
        answered: false,
        created_at: { $gte: since },
      };
      if (deptFilter.length > 0) matchStage.dept_id = { $in: deptFilter };

      // Group unanswered queries — return those exceeding cluster threshold
      const result = await QueryLog.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { dept_id: "$dept_id", query_text: "$query_text" },
            count: { $sum: 1 },
            first_seen: { $min: "$created_at" },
            last_seen: { $max: "$created_at" },
            query_ids: { $push: "$_id" },
          },
        },
        { $match: { count: { $gte: UNANSWERED_CLUSTER_THRESHOLD } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
        {
          $project: {
            _id: 0,
            dept_id: "$_id.dept_id",
            query_text: "$_id.query_text",
            count: 1,
            first_seen: 1,
            last_seen: 1,
            query_ids: 1,
          },
        },
      ]);

      return result as Array<{
        dept_id: string;
        query_text: string;
        count: number;
        first_seen: Date;
        last_seen: Date;
        query_ids: string[];
      }>;
    }),

  // Acknowledge (flag-clear) a specific unanswered query
  acknowledgeQuery: deptAdminProcedure
    .input(z.object({ query_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const collegeId = ctx.user.college_id;
      const conn = await getCollegeDb(collegeId);
      const QueryLog = getQueryLogModel(conn);

      const log = await QueryLog.findById(input.query_id).lean();
      if (!log) throw new TRPCError({ code: "NOT_FOUND", message: "Query log not found" });

      if (!ctx.user.is_college_owner && !ctx.user.dept_ids.includes(log.dept_id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
      }

      await QueryLog.findByIdAndUpdate(input.query_id, { $set: { flagged_to_admin: false } });
      return { ok: true };
    }),

  // Super admin: college-level stats
  collegeStats: superAdminProcedure
    .input(z.object({ college_id: z.string() }))
    .query(async ({ input }) => {
      const conn = await getCollegeDb(input.college_id);
      const QueryLog = getQueryLogModel(conn);
      const Document = getDocumentModel(conn);
      const Student = getStudentModel(conn);

      const since30d = new Date();
      since30d.setDate(since30d.getDate() - 30);

      const [totalQueries, answeredQueries, totalDocs, completedDocs, totalStudents] = await Promise.all([
        QueryLog.countDocuments({ college_id: input.college_id }),
        QueryLog.countDocuments({ college_id: input.college_id, answered: true }),
        Document.countDocuments({ college_id: input.college_id }),
        Document.countDocuments({ college_id: input.college_id, ingestion_status: "completed" }),
        Student.countDocuments({}),
      ]);

      return {
        total_queries: totalQueries,
        answered_queries: answeredQueries,
        answer_rate: totalQueries > 0 ? answeredQueries / totalQueries : 0,
        total_documents: totalDocs,
        completed_documents: completedDocs,
        total_students: totalStudents,
      };
    }),
});
