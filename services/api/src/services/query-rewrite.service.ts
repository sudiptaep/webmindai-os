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

export interface RewriteResult {
  rewritten_query: string;
  original_query: string;
  rewrite_applied: boolean;
  resolved_entities: string[];
}

const QUERY_REWRITE_HISTORY_TURNS = Number(process.env.QUERY_REWRITE_HISTORY_TURNS ?? 4);

// Cheap heuristic — skips the LLM call entirely for queries that plainly don't
// depend on prior turns. Pronouns/follow-up openers are the tell that a query
// can't be embedded standalone.
const PRONOUN_RE = /\b(it|its|it's|that|this|these|those|them|they|the same|above)\b/i;
const FOLLOWUP_RE = /^(what about|and\s|also\s|how about|why\b|then\s)/i;

function isSelfContained(query: string): boolean {
  return !PRONOUN_RE.test(query) && !FOLLOWUP_RE.test(query);
}

function passthrough(rawQuery: string): RewriteResult {
  return { rewritten_query: rawQuery, original_query: rawQuery, rewrite_applied: false, resolved_entities: [] };
}

/**
 * F-19-C: rewrites a student's follow-up question into a standalone query
 * before it's embedded for retrieval — resolving pronouns ("its", "that") and
 * carrying forward the topic from recent turns. This is the gap F-18-B's
 * formalisation-only rewrite missed: "what about its side effects?" embeds as
 * near-noise without knowing "it" is metformin.
 *
 * The rewritten text is used ONLY for the embedding/Pinecone lookup — the
 * original query still goes to the final LLM prompt and UI, so the answer
 * responds naturally to how the student actually asked.
 */
export async function rewriteQueryForRetrieval(
  rawQuery: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  context?: { deptName?: string; subjectName?: string | null },
  metering?: QueryRewriteMeteringContext,
): Promise<RewriteResult> {
  if (process.env.RAG_QUERY_REWRITE_ENABLED === "false") return passthrough(rawQuery);

  const recentTurns = conversationHistory.slice(-QUERY_REWRITE_HISTORY_TURNS);

  // Fast path: no history, and the query is already self-contained
  if (recentTurns.length === 0 && isSelfContained(rawQuery)) return passthrough(rawQuery);

  try {
    const response = await getClient().messages.create({
      model: LLM_MODEL_CHAT,
      max_tokens: 150,
      messages: [{
        role: "user",
        content: `You are rewriting a student's follow-up question so it can be
understood standalone by a search system.

Department: ${context?.deptName ?? "the department"}${context?.subjectName ? ` · Subject: ${context.subjectName}` : ""}

Recent conversation:
${recentTurns.map((t) => `${t.role}: ${t.content.slice(0, 300)}`).join("\n") || "(none)"}

Student's new question: "${rawQuery}"

Rewrite this question to be fully self-contained:
- Resolve all pronouns ("it", "its", "that", "this") to the actual entity
- Carry forward the topic being discussed if the question is a follow-up
- Use precise academic terminology suited to textbook prose
- Do NOT answer the question, only rewrite it
- If the question is already fully self-contained, return it unchanged

Return JSON only:
{"rewritten": "...", "resolved_entities": ["..."]}`,
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
    const rawText = (block.type === "text" ? block.text : "").trim().replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(rawText) as { rewritten?: string; resolved_entities?: string[] };

    const rewritten = parsed.rewritten?.trim() || rawQuery;
    return {
      rewritten_query: rewritten,
      original_query: rawQuery,
      rewrite_applied: rewritten !== rawQuery,
      resolved_entities: Array.isArray(parsed.resolved_entities) ? parsed.resolved_entities : [],
    };
  } catch {
    // Retrieval must never fail because the rewrite step failed.
    return passthrough(rawQuery);
  }
}
