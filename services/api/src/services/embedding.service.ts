import OpenAI from "openai";
import { EMBEDDING_MODEL } from "@college-chatbot/shared";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "./metering.service";

export interface EmbeddingMeteringContext {
  collegeId: string;
  deptId: string;
  actionType: "query_embedding" | "doc_ingestion";
  studentId?: string | null;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _client;
}

export async function embedQuery(
  text: string,
  metering?: EmbeddingMeteringContext,
): Promise<number[]> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.trim(),
  });

  if (metering) {
    const rate = await getRateTable("openai_embeddings", EMBEDDING_MODEL);
    const costUsd = (response.usage.total_tokens / 1000) * rate.input_token_cost_per_1k;
    recordCostEvent({
      college_id:       metering.collegeId,
      dept_id:          metering.deptId,
      student_id:       metering.studentId ?? undefined,
      action_type:      metering.actionType,
      service:          "openai_embeddings",
      model:            EMBEDDING_MODEL,
      embedding_tokens: response.usage.total_tokens,
      total_tokens:     response.usage.total_tokens,
      cost_usd:         costUsd,
      billing_month:    getBillingMonth(),
      billing_day:      getBillingDay(),
      created_at:       new Date(),
    });
  }

  return response.data[0].embedding;
}
