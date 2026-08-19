import { z } from "zod";
import { router, deptAdminProcedure } from "../trpc";
import { getTeachingProfileModel } from "../../models/college/teaching-profile.model";
import { getTeachingProfile, createDefaultTeachingProfile } from "../../services/teaching-profile.service";

const strategyEnum = z.enum([
  "analogy", "first_principles", "worked_example", "contrast_pair", "concrete_instance",
  "visual_spatial", "extreme_case", "error_analysis", "narrative_history", "mnemonic",
]);

export const teachingProfileRouter = router({
  get: deptAdminProcedure.query(async ({ ctx }) => {
    const conn = await ctx.getCollegeDb();
    return getTeachingProfile(conn, ctx.collegeId!, ctx.user.dept_id);
  }),

  update: deptAdminProcedure
    .input(z.object({
      strategy_preference_order: z.array(strategyEnum).optional(),
      analogy_policy: z.enum(["sparing", "liberal", "avoid"]).optional(),
      mnemonic_policy: z.enum(["freely", "only_for_lists", "avoid"]).optional(),
      rigour_level: z.enum(["high", "balanced", "accessible"]).optional(),
      always_include_clinical_connect: z.boolean().optional(),
      require_feynman_check: z.boolean().optional(),
      require_misconception_probe: z.boolean().optional(),
      default_bloom_target: z.enum(["remember", "understand", "apply", "analyse"]).optional(),
      default_entry_difficulty: z.number().min(0).max(3).optional(),
      max_session_minutes: z.number().min(5).max(60).optional(),
      max_backtrack_depth: z.number().min(0).max(5).optional(),
      custom_instruction: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.getCollegeDb();
      await createDefaultTeachingProfile(conn, ctx.collegeId!, ctx.user.dept_id);

      const TeachingProfileModel = getTeachingProfileModel(conn);
      const updated = await TeachingProfileModel.findOneAndUpdate(
        { dept_id: ctx.user.dept_id },
        { $set: { ...input, configured_by: ctx.user.sub } },
        { new: true },
      ).lean();
      return updated;
    }),
});

export type TeachingProfileRouter = typeof teachingProfileRouter;
