import Anthropic from "@anthropic-ai/sdk";
import { LLM_MODEL_CHAT, LLM_MODEL_EXAM, LLM_MAX_TOKENS } from "@college-chatbot/shared";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "./metering.service";
import { updateAnthropicMetrics } from "../jobs/probes/anthropic.probe";

export interface LLMStreamResult {
  tokenStream: AsyncGenerator<string, void, unknown>;
  /** Resolves after stream ends with total tokens consumed */
  getUsage: () => Promise<number>;
}

export interface LLMMeteringContext {
  collegeId: string;
  deptId: string;
  studentId?: string | null;
  sessionId?: string | null;
  actionType: "chat_message" | "ai_summary" | "exam_generation";
}

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export async function streamChatResponse(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  model: string = LLM_MODEL_CHAT,
  metering?: LLMMeteringContext,
): Promise<LLMStreamResult> {
  const client = getClient();

  const stream = client.messages.stream({
    model,
    max_tokens: LLM_MAX_TOKENS,
    system: systemPrompt,
    messages,
  });

  let tokensUsed = 0;
  const streamStart = Date.now();
  const usagePromise = stream.finalMessage().then(async (msg) => {
    tokensUsed = msg.usage.input_tokens + msg.usage.output_tokens;
    const latencyMs = Date.now() - streamStart;
    updateAnthropicMetrics(msg.usage.input_tokens, msg.usage.output_tokens, latencyMs, true);
    if (metering) {
      const rate = await getRateTable("anthropic", model);
      const costUsd =
        (msg.usage.input_tokens  / 1000) * rate.input_token_cost_per_1k +
        (msg.usage.output_tokens / 1000) * rate.output_token_cost_per_1k;
      recordCostEvent({
        college_id:    metering.collegeId,
        dept_id:       metering.deptId,
        student_id:    metering.studentId ?? undefined,
        session_id:    metering.sessionId ?? undefined,
        action_type:   metering.actionType,
        service:       "anthropic",
        model,
        input_tokens:  msg.usage.input_tokens,
        output_tokens: msg.usage.output_tokens,
        total_tokens:  tokensUsed,
        cost_usd:      costUsd,
        billing_month: getBillingMonth(),
        billing_day:   getBillingDay(),
        created_at:    new Date(),
      });
    }
    return tokensUsed;
  });

  async function* tokenGenerator(): AsyncGenerator<string, void, unknown> {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }

  return {
    tokenStream: tokenGenerator(),
    getUsage: () => usagePromise,
  };
}

export async function generateExamQuestions(
  systemPrompt: string,
  userMessage: string,
  metering?: LLMMeteringContext,
): Promise<string> {
  const client = getClient();
  const examStart = Date.now();
  const msg = await client.messages.create({
    model: LLM_MODEL_EXAM,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  updateAnthropicMetrics(msg.usage.input_tokens, msg.usage.output_tokens, Date.now() - examStart, true);
  if (metering) {
    const rate = await getRateTable("anthropic", LLM_MODEL_EXAM);
    const costUsd =
      (msg.usage.input_tokens  / 1000) * rate.input_token_cost_per_1k +
      (msg.usage.output_tokens / 1000) * rate.output_token_cost_per_1k;
    recordCostEvent({
      college_id:    metering.collegeId,
      dept_id:       metering.deptId,
      student_id:    metering.studentId ?? undefined,
      session_id:    metering.sessionId ?? undefined,
      action_type:   "exam_generation",
      service:       "anthropic",
      model:         LLM_MODEL_EXAM,
      input_tokens:  msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      total_tokens:  msg.usage.input_tokens + msg.usage.output_tokens,
      cost_usd:      costUsd,
      billing_month: getBillingMonth(),
      billing_day:   getBillingDay(),
      created_at:    new Date(),
    });
  }

  const block = msg.content[0];
  return block.type === "text" ? block.text : "";
}
