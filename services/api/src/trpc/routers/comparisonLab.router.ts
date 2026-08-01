import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { getCollegeDb } from "../../db/college.db";
import { getGoldenQuestionModel } from "../../models/college/golden-question.model";
import { getComparisonRunModel } from "../../models/college/comparison-run.model";
import { getDocumentModel } from "../../models/college/document.model";
import { runComparison } from "../../services/comparison-lab.service";
import { isDeptAdmin, isSuperAdmin, type DeptAdminJWTPayload, type AnyJWTPayload } from "@college-chatbot/shared";

function requireAdminRole(user: AnyJWTPayload | null | undefined): asserts user is AnyJWTPayload {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  if (!isSuperAdmin(user) && !isDeptAdmin(user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" });
  }
}

async function resolveCollegeConn(user: AnyJWTPayload, collegeId: string) {
  if (isSuperAdmin(user)) return getCollegeDb(collegeId);
  if (isDeptAdmin(user)) {
    if (user.college_id !== collegeId) throw new TRPCError({ code: "FORBIDDEN", message: "College mismatch" });
    return getCollegeDb(collegeId);
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient role" });
}

function checkDeptScope(user: DeptAdminJWTPayload, deptId: string) {
  if (user.dept_id !== deptId) throw new TRPCError({ code: "FORBIDDEN", message: "Dept scope not permitted" });
}

export const comparisonLabRouter = router({
  // ── Golden question bank ──────────────────────────────────────────────────

  listGoldenQuestions: protectedProcedure
    .input(z.object({ college_id: z.string(), dept_id: z.string(), subject_id: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, input.dept_id);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const GoldenQuestion = getGoldenQuestionModel(conn);

      const filter: Record<string, unknown> = { dept_id: input.dept_id };
      if (input.subject_id) filter.subject_id = input.subject_id;

      return GoldenQuestion.find(filter).sort({ created_at: -1 }).lean();
    }),

  createGoldenQuestion: protectedProcedure
    .input(z.object({
      college_id: z.string(),
      dept_id: z.string(),
      subject_id: z.string().optional(),
      question_text: z.string().min(1),
      expected_source_doc_id: z.string().optional(),
      expected_source_page: z.number().int().positive().optional(),
      expected_answer_summary: z.string().optional(),
      difficulty: z.enum(["recall", "application", "analysis"]).default("recall"),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, input.dept_id);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const GoldenQuestion = getGoldenQuestionModel(conn);

      const created = await GoldenQuestion.create({
        college_id: input.college_id,
        dept_id: input.dept_id,
        subject_id: input.subject_id,
        question_text: input.question_text,
        expected_source_doc_id: input.expected_source_doc_id,
        expected_source_page: input.expected_source_page,
        expected_answer_summary: input.expected_answer_summary,
        difficulty: input.difficulty,
        added_by: ctx.user.sub,
        active: true,
      });
      return created.toObject();
    }),

  deleteGoldenQuestion: protectedProcedure
    .input(z.object({ college_id: z.string(), dept_id: z.string(), question_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, input.dept_id);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const GoldenQuestion = getGoldenQuestionModel(conn);
      await GoldenQuestion.deleteOne({ _id: input.question_id, dept_id: input.dept_id });
      return { ok: true };
    }),

  // ── Comparison runs ────────────────────────────────────────────────────────

  runComparison: protectedProcedure
    .input(z.object({
      college_id: z.string(),
      dept_id: z.string(),
      subject_id: z.string().optional(),
      question_text: z.string().min(1),
      golden_question_id: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, input.dept_id);

      return runComparison({
        questionText: input.question_text,
        collegeId: input.college_id,
        deptId: input.dept_id,
        subjectId: input.subject_id,
        goldenQuestionId: input.golden_question_id,
      });
    }),

  listRuns: protectedProcedure
    .input(z.object({
      college_id: z.string(),
      dept_id: z.string(),
      failure_signature: z.enum(["none", "extraction_failure", "retrieval_failure", "expected_divergence"]).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, input.dept_id);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const ComparisonRun = getComparisonRunModel(conn);

      const filter: Record<string, unknown> = { dept_id: input.dept_id };
      if (input.failure_signature) filter.failure_signature = input.failure_signature;

      const skip = (input.page - 1) * input.limit;
      const [runs, total] = await Promise.all([
        ComparisonRun.find(filter).sort({ created_at: -1 }).skip(skip).limit(input.limit).lean(),
        ComparisonRun.countDocuments(filter),
      ]);
      return { runs, total, page: input.page, limit: input.limit };
    }),

  reviewRun: protectedProcedure
    .input(z.object({
      college_id: z.string(),
      dept_id: z.string(),
      run_id: z.string(),
      human_verdict: z.enum(["grounded_better", "frontier_better", "equivalent", "both_wrong"]),
      human_notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, input.dept_id);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const ComparisonRun = getComparisonRunModel(conn);

      const updated = await ComparisonRun.findOneAndUpdate(
        { _id: input.run_id, dept_id: input.dept_id },
        {
          $set: {
            human_verdict: input.human_verdict,
            human_notes: input.human_notes,
            reviewed_by: ctx.user.sub,
            reviewed_at: new Date(),
          },
        },
        { new: true, lean: true },
      );
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Comparison run not found" });
      return updated;
    }),

  // ── Regression dashboard ──────────────────────────────────────────────────

  regressionDashboard: protectedProcedure
    .input(z.object({ college_id: z.string(), dept_id: z.string(), days: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      requireAdminRole(ctx.user);
      if (isDeptAdmin(ctx.user)) checkDeptScope(ctx.user, input.dept_id);
      const conn = await resolveCollegeConn(ctx.user, input.college_id);
      const ComparisonRun = getComparisonRunModel(conn);
      const Document = getDocumentModel(conn);

      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const faithfulnessTrend = await ComparisonRun.aggregate([
        { $match: { dept_id: input.dept_id, created_at: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
            avg_faithfulness: { $avg: "$faithfulness_score" },
            run_count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", avg_faithfulness: 1, run_count: 1 } },
      ]);

      // Docs cited in low-faithfulness runs, cross-referenced against their own
      // quality_score — this is what closes the loop back to F-18-A.
      const lowFaithfulnessRuns = await ComparisonRun.find({
        dept_id: input.dept_id,
        created_at: { $gte: since },
        faithfulness_score: { $lt: 0.7 },
      }).lean();

      const citedDocIds = [...new Set(lowFaithfulnessRuns.flatMap((r) => r.grounded_sources.map((s) => s.doc_id)))];
      const flaggedDocuments = citedDocIds.length > 0
        ? await Document.find({ _id: { $in: citedDocIds }, quality_score: { $lt: 0.7 } })
            .select("original_filename quality_score signal_breakdown")
            .lean()
        : [];

      const alerts = faithfulnessTrend
        .filter((row, i, arr) => {
          if (i === 0) return false;
          const prev = arr[i - 1];
          return prev.avg_faithfulness - row.avg_faithfulness > 0.1;
        })
        .map((row) => `Faithfulness dropped on ${row.date}`);

      return { faithfulness_trend: faithfulnessTrend, alerts, flagged_documents: flaggedDocuments };
    }),
});
