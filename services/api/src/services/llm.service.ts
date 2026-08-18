import Anthropic from "@anthropic-ai/sdk";
import { LLM_MODEL_CHAT, LLM_MODEL_EXAM, LLM_MAX_TOKENS } from "@college-chatbot/shared";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "./metering.service";
import { updateAnthropicMetrics } from "../jobs/probes/anthropic.probe";

export interface LLMStreamResult {
  tokenStream: AsyncGenerator<string, void, unknown>;
  /** Resolves after stream ends with total tokens consumed */
  getUsage: () => Promise<number>;
  /** Resolves after stream ends with the Anthropic stop_reason (F-18-D truncation detection) */
  getStopReason: () => Promise<string | null>;
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
  maxTokens: number = LLM_MAX_TOKENS,
): Promise<LLMStreamResult> {
  const client = getClient();

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  let tokensUsed = 0;
  const streamStart = Date.now();
  const finalMessagePromise = stream.finalMessage();

  // stopReasonPromise/usagePromise are only actually awaited (via getUsage/
  // getStopReason below) AFTER the caller finishes consuming tokenStream —
  // which can be seconds later. If finalMessagePromise rejects (e.g. an
  // Anthropic account-limit/429 error) before that, these derived .then()
  // chains reject immediately with NO handler attached yet — Node flags
  // that as an unhandled rejection right away and, on modern Node, crashes
  // the entire process. .catch() here so Node always sees them as handled
  // the moment they're created; the real error still surfaces to the caller
  // through tokenGenerator()'s `for await` below, which IS awaited promptly
  // inside the caller's try/catch — nothing is silently swallowed, this only
  // stops a duplicate, delayed rejection from being fatal on its own.
  const stopReasonPromise = finalMessagePromise
    .then((msg) => msg.stop_reason)
    .catch(() => null);
  const usagePromise = finalMessagePromise
    .then(async (msg) => {
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
    })
    .catch(() => 0);

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
    getStopReason: () => stopReasonPromise,
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
