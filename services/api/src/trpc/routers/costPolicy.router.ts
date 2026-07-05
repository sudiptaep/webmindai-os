import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure } from "../trpc";
import { getCostPolicyModel } from "../../models/platform/cost-policy.model";
import { getRateTableModel } from "../../models/platform/rate-table.model";
import { bustPolicyCache } from "../../services/cost-policy.service";
import { getRedisConnection } from "../../services/queue.service";

const PolicyInputSchema = z.object({
  llm_token_limit_per_month:              z.number().int().positive().optional(),
  llm_token_soft_warn_pct:                z.number().min(1).max(100).optional(),
  llm_token_hard_stop:                    z.boolean().optional(),
  max_chat_queries_per_student_per_day:   z.number().int().positive().optional(),
  max_ai_summaries_per_student_per_day:   z.number().int().positive().optional(),
  max_exam_gen_per_student_per_day:       z.number().int().positive().optional(),
  allowed_llm_models:                     z.array(z.string()).optional(),
  embedding_model:                        z.string().optional(),
  cost_budget_usd_per_month:              z.number().positive().optional(),
  cost_soft_warn_pct:                     z.number().min(1).max(100).optional(),
  storage_limit_gb:                       z.number().positive().optional(),
  notes:                                  z.string().optional(),
});

export const costPolicyRouter = router({
  getGlobalPolicy: superAdminProcedure.query(async () => {
    const CostPolicy = getCostPolicyModel();
    return CostPolicy.findOne({ target_type: "global", target_id: "global" }).lean();
  }),

  setGlobalPolicy: superAdminProcedure
    .input(PolicyInputSchema)
    .mutation(async ({ input, ctx }) => {
      const CostPolicy = getCostPolicyModel();
      const adminId = ctx.user.sub;
      await CostPolicy.updateOne(
        { target_type: "global", target_id: "global" },
        { $set: { ...input, target_type: "global", target_id: "global", created_by: adminId } },
        { upsert: true },
      );
      // Bust all policy caches — global affects everything
      const redis = getRedisConnection();
      const keys = await redis.keys("policy:*");
      if (keys.length > 0) await redis.del(...keys);
      return { ok: true };
    }),

  getCollegePolicy: superAdminProcedure
    .input(z.object({ collegeId: z.string() }))
    .query(async ({ input }) => {
      const CostPolicy = getCostPolicyModel();
      return CostPolicy.findOne({ target_type: "college", target_id: input.collegeId }).lean();
    }),

  setCollegePolicy: superAdminProcedure
    .input(z.object({ collegeId: z.string(), policy: PolicyInputSchema }))
    .mutation(async ({ input, ctx }) => {
      const CostPolicy = getCostPolicyModel();
      const adminId = ctx.user.sub;
      await CostPolicy.updateOne(
        { target_type: "college", target_id: input.collegeId },
        { $set: { ...input.policy, target_type: "college", target_id: input.collegeId, college_id: input.collegeId, created_by: adminId } },
        { upsert: true },
      );
      await bustPolicyCache(input.collegeId);
      return { ok: true };
    }),

  deleteCollegePolicy: superAdminProcedure
    .input(z.object({ collegeId: z.string() }))
    .mutation(async ({ input }) => {
      const CostPolicy = getCostPolicyModel();
      await CostPolicy.deleteOne({ target_type: "college", target_id: input.collegeId });
      await bustPolicyCache(input.collegeId);
      return { ok: true };
    }),

  getDeptPolicy: superAdminProcedure
    .input(z.object({ deptId: z.string() }))
    .query(async ({ input }) => {
      const CostPolicy = getCostPolicyModel();
      return CostPolicy.findOne({ target_type: "dept", target_id: input.deptId }).lean();
    }),

  setDeptPolicy: superAdminProcedure
    .input(z.object({
      deptId: z.string(),
      collegeId: z.string(),
      policy: PolicyInputSchema.extend({
        // Department budgets are capped platform-wide — enforced here, not just in the UI,
        // since a college/dept admin route calling this directly would otherwise bypass it.
        cost_budget_usd_per_month: z.number().positive().max(50, "Department budget cannot exceed $50/month").optional(),
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      const CostPolicy = getCostPolicyModel();
      const adminId = ctx.user.sub;
      await CostPolicy.updateOne(
        { target_type: "dept", target_id: input.deptId },
        { $set: { ...input.policy, target_type: "dept", target_id: input.deptId, college_id: input.collegeId, created_by: adminId } },
        { upsert: true },
      );
      await bustPolicyCache(input.collegeId, input.deptId);
      return { ok: true };
    }),

  deleteDeptPolicy: superAdminProcedure
    .input(z.object({ deptId: z.string(), collegeId: z.string() }))
    .mutation(async ({ input }) => {
      const CostPolicy = getCostPolicyModel();
      await CostPolicy.deleteOne({ target_type: "dept", target_id: input.deptId });
      await bustPolicyCache(input.collegeId, input.deptId);
      return { ok: true };
    }),

  getAllCollegePolicies: superAdminProcedure
    .input(z.object({ collegeId: z.string() }))
    .query(async ({ input }) => {
      const CostPolicy = getCostPolicyModel();
      const [collegePol, deptPolicies] = await Promise.all([
        CostPolicy.findOne({ target_type: "college", target_id: input.collegeId }).lean(),
        CostPolicy.find({ target_type: "dept", college_id: input.collegeId }).lean(),
      ]);
      return { college: collegePol, depts: deptPolicies };
    }),

  getRateTable: superAdminProcedure.query(async () => {
    const RateTable = getRateTableModel();
    return RateTable.find().sort({ service: 1, model: 1 }).lean();
  }),

  updateRateTable: superAdminProcedure
    .input(z.object({
      service: z.enum(["anthropic", "openai_embeddings", "cohere", "pinecone"]),
      model: z.string(),
      input_token_cost_per_1k: z.number().optional(),
      output_token_cost_per_1k: z.number().optional(),
      per_unit_cost: z.number().optional(),
      storage_cost_per_gb_per_month: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const RateTable = getRateTableModel();
      const adminId = ctx.user.sub;
      const { service, model, ...pricing } = input;
      await RateTable.updateOne(
        { service, model },
        { $set: { ...pricing, updated_by: adminId, effective_from: new Date() } },
        { upsert: true },
      );
      // Bust rate table cache for this entry
      const redis = getRedisConnection();
      await redis.del(`rate:${service}:${model}`);
      return { ok: true };
    }),
});
