import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import { verifySuperAdminJWT } from "../middleware/verifySuperAdminJWT";
import { getMonthlyCostSummaryModel } from "../models/platform/monthly-cost-summary.model";
import { getCostEventModel } from "../models/platform/cost-event.model";
import { getBillingMonth } from "../services/metering.service";

export const superAdminCostRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/v1/super-admin/colleges/:collegeId/costs/export?month=2026-05
  fastify.get(
    "/colleges/:collegeId/costs/export",
    { preHandler: [verifySuperAdminJWT] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { collegeId } = request.params as { collegeId: string };
      const { month } = request.query as { month?: string };
      const billingMonth = month ?? getBillingMonth();

      const Summary = getMonthlyCostSummaryModel();
      const CostEvent = getCostEventModel();

      const deptSummaries = await Summary.find({
        billing_month: billingMonth,
        college_id: collegeId,
        dept_id: { $ne: "ALL" },
      }).lean();

      // College-level rollup
      const collegeSummary = await Summary.findOne({
        billing_month: billingMonth,
        college_id: collegeId,
        dept_id: "ALL",
      }).lean();

      // Build CSV rows
      const headers = [
        "dept_id", "billing_month", "total_cost_usd", "anthropic_cost_usd", "openai_cost_usd",
        "cohere_cost_usd", "pinecone_cost_usd", "llm_input_tokens", "llm_output_tokens",
        "embedding_tokens", "chat_message_count", "ai_summary_count", "exam_gen_count",
        "doc_ingestion_count", "unique_students", "token_utilisation_pct", "cost_utilisation_pct",
      ].join(",");

      function rowToCSV(s: typeof deptSummaries[0]): string {
        return [
          s.dept_id, s.billing_month,
          s.total_cost_usd.toFixed(6), s.anthropic_cost_usd.toFixed(6), s.openai_cost_usd.toFixed(6),
          s.cohere_cost_usd.toFixed(6), s.pinecone_cost_usd.toFixed(6),
          s.llm_input_tokens, s.llm_output_tokens, s.embedding_tokens,
          s.chat_message_count, s.ai_summary_count, s.exam_gen_count, s.doc_ingestion_count,
          s.unique_students,
          s.token_utilisation_pct.toFixed(2), s.cost_utilisation_pct.toFixed(2),
        ].join(",");
      }

      const rows = [
        ...(collegeSummary ? [rowToCSV(collegeSummary)] : []),
        ...deptSummaries.map(rowToCSV),
      ];
      const csv = [headers, ...rows].join("\n");

      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", `attachment; filename="costs-${collegeId}-${billingMonth}.csv"`)
        .send(csv);
    },
  );
};
