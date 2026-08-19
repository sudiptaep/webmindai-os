import { randomUUID } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, deptAdminProcedure } from "../trpc";
import { getMisconceptionModel } from "../../models/college/misconception.model";
import { getConceptModel } from "../../models/college/concept-graph.model";
import { runMisconceptionMining } from "../../jobs/mineMisconceptions";

export const misconceptionRouter = router({
  list: deptAdminProcedure
    .input(z.object({
      concept_id: z.string().optional(),
      source: z.enum(["llm_seeded", "observed_from_students", "seeded_and_observed", "faculty_authored"]).optional(),
      sort: z.enum(["observed_count", "correction_success_rate"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Misconception = getMisconceptionModel(conn);
      const filter: Record<string, unknown> = { dept_id: ctx.user.dept_id };
      if (input.concept_id) filter.concept_id = input.concept_id;
      if (input.source) filter.source = input.source;

      const sort: Record<string, 1 | -1> =
        input.sort === "correction_success_rate" ? { correction_success_rate: 1 } : { observed_count: -1 };

      return Misconception.find(filter).sort(sort).lean();
    }),

  create: deptAdminProcedure
    .input(z.object({
      concept_id: z.string(),
      statement: z.string().min(1),
      correct_model: z.string().min(1),
      root_cause: z.string().default(""),
      diagnostic_probe: z.string().min(1),
      probe_correct_answer: z.string().default(""),
      probe_wrong_answer: z.string().default(""),
    }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Concept = getConceptModel(conn);
      const Misconception = getMisconceptionModel(conn);

      const concept = await Concept.findOne({ _id: input.concept_id, dept_id: ctx.user.dept_id }).lean();
      if (!concept) throw new TRPCError({ code: "NOT_FOUND", message: "Concept not found" });

      const now = new Date();
      const doc = await Misconception.create({
        _id: randomUUID(),
        college_id: ctx.collegeId,
        dept_id: ctx.user.dept_id,
        ...input,
        source: "faculty_authored",
        observed_count: 0,
        first_observed: now,
        last_observed: now,
        times_probed: 0,
        times_corrected: 0,
        correction_success_rate: null,
        reviewed_by_faculty: true,
        priority_rank: 0,
      });
      return doc.toObject();
    }),

  update: deptAdminProcedure
    .input(z.object({
      misconception_id: z.string(),
      statement: z.string().optional(),
      correct_model: z.string().optional(),
      root_cause: z.string().optional(),
      diagnostic_probe: z.string().optional(),
      probe_correct_answer: z.string().optional(),
      probe_wrong_answer: z.string().optional(),
      priority_rank: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { misconception_id, ...patch } = input;
      const conn = await ctx.getCollegeDb();
      const Misconception = getMisconceptionModel(conn);

      const m = await Misconception.findOne({ _id: misconception_id, dept_id: ctx.user.dept_id });
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Misconception not found" });

      Object.assign(m, patch, { reviewed_by_faculty: true });
      await m.save();
      return m.toObject();
    }),

  delete: deptAdminProcedure
    .input(z.object({ misconception_id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      const Misconception = getMisconceptionModel(conn);
      const result = await Misconception.deleteOne({ _id: input.misconception_id, dept_id: ctx.user.dept_id });
      if (result.deletedCount === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Misconception not found" });
      return { success: true };
    }),

  // Manually trigger the nightly mining job for just this department
  mine: deptAdminProcedure.mutation(async ({ ctx }) => {
    if (!ctx.collegeId) throw new TRPCError({ code: "BAD_REQUEST" });
    await runMisconceptionMining(ctx.collegeId, ctx.user.dept_id);
    return { success: true };
  }),
});

export type MisconceptionRouter = typeof misconceptionRouter;
