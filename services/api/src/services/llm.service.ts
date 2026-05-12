import Anthropic from "@anthropic-ai/sdk";
import { LLM_MODEL_CHAT, LLM_MODEL_EXAM, LLM_MAX_TOKENS } from "@college-chatbot/shared";

export interface LLMStreamResult {
  tokenStream: AsyncGenerator<string, void, unknown>;
  /** Resolves after stream ends with total tokens consumed */
  getUsage: () => Promise<number>;
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
): Promise<LLMStreamResult> {
  const client = getClient();

  const stream = client.messages.stream({
    model,
    max_tokens: LLM_MAX_TOKENS,
    system: systemPrompt,
    messages,
  });

  let tokensUsed = 0;
  const usagePromise = stream.finalMessage().then((msg) => {
    tokensUsed = msg.usage.input_tokens + msg.usage.output_tokens;
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
): Promise<string> {
  const client = getClient();
  const msg = await client.messages.create({
    model: LLM_MODEL_EXAM,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = msg.content[0];
  return block.type === "text" ? block.text : "";
}
