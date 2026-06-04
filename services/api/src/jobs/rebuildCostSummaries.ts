import { getCostEventModel } from "../models/platform/cost-event.model";
import { getMonthlyCostSummaryModel } from "../models/platform/monthly-cost-summary.model";
import { resolvePolicy } from "../services/cost-policy.service";
import { getBillingMonth } from "../services/metering.service";

export async function runRebuildCostSummaries(): Promise<void> {
  const currentMonth = getBillingMonth();
  const CostEvent = getCostEventModel();
  const Summary = getMonthlyCostSummaryModel();

  // Get all unique (college_id, dept_id) combinations for this month
  const dimensions = await CostEvent.aggregate([
    { $match: { billing_month: currentMonth } },
    { $group: { _id: { college_id: "$college_id", dept_id: "$dept_id" } } },
  ]);

  const collegeIds = [...new Set(dimensions.map((d: { _id: { college_id: string } }) => d._id.college_id))];

  // Build college-level rollups (dept_id = "ALL") plus per-dept summaries
  const allTargets: Array<{ college_id: string; dept_id: string }> = [
    ...dimensions.map((d: { _id: { college_id: string; dept_id: string } }) => d._id),
    ...collegeIds.map((cid) => ({ college_id: cid as string, dept_id: "ALL" })),
  ];

  for (const { college_id, dept_id } of allTargets) {
    const matchStage: Record<string, unknown> = { college_id, billing_month: currentMonth };
    if (dept_id !== "ALL") matchStage.dept_id = dept_id;

    const [agg] = await CostEvent.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          anthropic_cost_usd:   { $sum: { $cond: [{ $eq: ["$service", "anthropic"] },        "$cost_usd", 0] } },
          openai_cost_usd:      { $sum: { $cond: [{ $eq: ["$service", "openai_embeddings"] }, "$cost_usd", 0] } },
          cohere_cost_usd:      { $sum: { $cond: [{ $eq: ["$service", "cohere"] },            "$cost_usd", 0] } },
          pinecone_cost_usd:    { $sum: { $cond: [{ $eq: ["$service", "pinecone"] },          "$cost_usd", 0] } },
          total_cost_usd:       { $sum: "$cost_usd" },
          llm_input_tokens:     { $sum: "$input_tokens" },
          llm_output_tokens:    { $sum: "$output_tokens" },
          embedding_tokens:     { $sum: "$embedding_tokens" },
          rerank_calls:         { $sum: "$rerank_units" },
          pinecone_write_units: { $sum: "$vector_write_units" },
          pinecone_read_units:  { $sum: "$vector_read_units" },
          chat_message_count:   { $sum: { $cond: [{ $eq: ["$action_type", "chat_message"] },    1, 0] } },
          ai_summary_count:     { $sum: { $cond: [{ $eq: ["$action_type", "ai_summary"] },      1, 0] } },
          exam_gen_count:       { $sum: { $cond: [{ $eq: ["$action_type", "exam_generation"] }, 1, 0] } },
          doc_ingestion_count:  { $sum: { $cond: [{ $eq: ["$action_type", "doc_ingestion"] },   1, 0] } },
          student_ids:          { $addToSet: "$student_id" },
        },
      },
      {
        $project: {
          _id: 0,
          anthropic_cost_usd: 1, openai_cost_usd: 1, cohere_cost_usd: 1, pinecone_cost_usd: 1,
          total_cost_usd: 1, llm_input_tokens: 1, llm_output_tokens: 1, embedding_tokens: 1,
          rerank_calls: 1, pinecone_write_units: 1, pinecone_read_units: 1,
          chat_message_count: 1, ai_summary_count: 1, exam_gen_count: 1, doc_ingestion_count: 1,
          unique_students: { $subtract: [{ $size: "$student_ids" }, { $cond: [{ $in: [null, "$student_ids"] }, 1, 0] }] },
        },
      },
    ]);

    if (!agg) continue;

    const policy = await resolvePolicy(college_id, dept_id === "ALL" ? null : dept_id);
    const totalLlmTokens = (agg.llm_input_tokens ?? 0) + (agg.llm_output_tokens ?? 0);

    await Summary.updateOne(
      { billing_month: currentMonth, college_id, dept_id },
      {
        $set: {
          ...agg,
          billing_month: currentMonth,
          college_id,
          dept_id,
          llm_token_limit:       policy.llm_token_limit_per_month,
          token_utilisation_pct: policy.llm_token_limit_per_month > 0
            ? (totalLlmTokens / policy.llm_token_limit_per_month) * 100
            : 0,
          cost_budget_usd:       policy.cost_budget_usd_per_month,
          cost_utilisation_pct:  policy.cost_budget_usd_per_month > 0
            ? ((agg.total_cost_usd ?? 0) / policy.cost_budget_usd_per_month) * 100
            : 0,
          storage_used_gb:       0, // populated separately by storage scanner
          computed_at:           new Date(),
        },
      },
      { upsert: true },
    );
  }

  console.info(`[rebuildCostSummaries] rebuilt ${allTargets.length} summaries for ${currentMonth}`);
}
