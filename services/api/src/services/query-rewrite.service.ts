import Anthropic from "@anthropic-ai/sdk";
import { LLM_MODEL_CHAT } from "@college-chatbot/shared";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "./metering.service";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export interface QueryRewriteMeteringContext {
  collegeId: string;
  deptId: string;
  studentId?: string | null;
  sessionId?: string | null;
}

/**
 * F-18-B: rewrites a colloquial student question into precise academic
 * phrasing before it's embedded for retrieval. The rewritten text is used
 * ONLY for the embedding/Pinecone lookup — the original query still goes to
 * the final LLM prompt and UI, so the answer still responds naturally to how
 * the student actually asked.
 */
export async function rewriteQueryForRetrieval(rawQuery: string, metering?: QueryRewriteMeteringContext): Promise<string> {
  if (process.env.RAG_QUERY_REWRITE_ENABLED === "false") return rawQuery;

  try {
    const response = await getClient().messages.create({
      model: LLM_MODEL_CHAT,
      max_tokens: 100,
      messages: [{
        role: "user",
        content: `Rewrite this student question into precise, formal academic phrasing suitable for matching against textbook prose. Keep the same meaning and intent. Return ONLY the rewritten question, nothing else.

Student question: "${rawQuery}"`,
      }],
    });

    if (metering) {
      const rate = await getRateTable("anthropic", LLM_MODEL_CHAT);
      const costUsd =
        (response.usage.input_tokens / 1000) * rate.input_token_cost_per_1k +
        (response.usage.output_tokens / 1000) * rate.output_token_cost_per_1k;
      recordCostEvent({
        college_id: metering.collegeId,
        dept_id: metering.deptId,
        student_id: metering.studentId ?? undefined,
        session_id: metering.sessionId ?? undefined,
        action_type: "query_rewrite",
        service: "anthropic",
        model: LLM_MODEL_CHAT,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
        cost_usd: costUsd,
        billing_month: getBillingMonth(),
        billing_day: getBillingDay(),
        created_at: new Date(),
      });
    }

    const block = response.content[0];
    const rewritten = block.type === "text" ? block.text.trim() : "";
    return rewritten || rawQuery;
  } catch {
    // Retrieval must never fail because the rewrite step failed.
    return rawQuery;
  }
}
