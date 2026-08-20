import Anthropic from "@anthropic-ai/sdk";
import type { TeachingSession, PendingCheck, ExplanationStrategy } from "@college-chatbot/shared";
import { LLM_MODEL_CHAT } from "@college-chatbot/shared";
import { selectStrategy } from "../strategy.service";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "../metering.service";
import { buildTeachingSystemPrompt } from "./prompt";
import { TeachingPhase, getPhaseDefinition, type DifficultyLevel } from "./phases";
import type { SessionContext, TeachingTurn, CheckEvaluation } from "./types";

const TEACHING_MODEL = process.env.TEACHING_MODEL ?? LLM_MODEL_CHAT;
const TEACHING_MAX_TOKENS = Number(process.env.TEACHING_MAX_TOKENS_PER_TURN ?? 1200);
const CHECK_EVAL_MODEL = process.env.TEACHING_CHECK_EVAL_MODEL ?? LLM_MODEL_CHAT;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export interface TeachingMeteringContext {
  collegeId: string;
  deptId: string;
  studentId: string;
  sessionId: string;
}

/** F-12/F-20 Step 11: records one teaching-engine LLM call (turn generation
 * or check evaluation) as a cost_event, same shape as every other metered
 * LLM call in the platform. */
async function recordTeachingCost(
  metering: TeachingMeteringContext,
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): Promise<void> {
  const rate = await getRateTable("anthropic", model);
  const costUsd =
    (usage.input_tokens / 1000) * rate.input_token_cost_per_1k +
    (usage.output_tokens / 1000) * rate.output_token_cost_per_1k;

  recordCostEvent({
    college_id: metering.collegeId,
    dept_id: metering.deptId,
    student_id: metering.studentId,
    session_id: metering.sessionId,
    action_type: "teaching_session",
    service: "anthropic",
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.input_tokens + usage.output_tokens,
    cost_usd: costUsd,
    billing_month: getBillingMonth(),
    billing_day: getBillingDay(),
    created_at: new Date(),
  });
}

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function buildTurnMessages(session: Pick<TeachingSession, "turns">): Array<{ role: "user" | "assistant"; content: string }> {
  const recent = session.turns.slice(-6);
  if (recent.length === 0) return [{ role: "user", content: "Begin the session." }];

  const messages = recent.map((t) => ({
    role: t.role === "student" ? ("user" as const) : ("assistant" as const),
    content: t.content,
  }));
  // Anthropic requires the message array to start with a user turn.
  if (messages[0].role !== "user") messages.unshift({ role: "user", content: "Begin the session." });
  return messages;
}

export interface GenerateTurnParams {
  session: Pick<TeachingSession, "_id" | "student_id" | "turns" | "current_phase" | "current_step_index" | "build_steps_total" | "strategies_failed" | "strategies_attempted" | "current_strategy" | "current_difficulty_level">;
  ctx: SessionContext;
}

export interface GeneratedTurnResult {
  turn: TeachingTurn;
  strategy: ExplanationStrategy;
  tokensUsed: number;
}

/** Generates the assistant's next teaching turn — grounded in the session
 * context's source chunks, shaped by phase/strategy/difficulty (F-20-C §6.5). */
export async function generatePhaseTurn(params: GenerateTurnParams): Promise<GeneratedTurnResult> {
  const { session, ctx } = params;
  const phase = session.current_phase as TeachingPhase;
  const phaseDef = getPhaseDefinition(phase);

  const strategy = session.current_strategy ?? selectStrategy({
    conceptType: ctx.concept.concept_type,
    hasRelevantImage: ctx.hasRelevantImage,
    strategiesFailed: session.strategies_failed,
    strategiesAttempted: session.strategies_attempted,
    analogyPolicy: ctx.teachingProfile.analogy_policy,
    mnemonicPolicy: ctx.teachingProfile.mnemonic_policy,
    strategySuccessRates: ctx.learnerModel.strategy_success_rates,
    strategyPreferenceOrder: ctx.teachingProfile.strategy_preference_order,
  });
  const level = session.current_difficulty_level as DifficultyLevel;
  const fadeLevel = phase === TeachingPhase.GUIDED_PRACTICE ? Math.max(0, 2 - session.current_step_index) : 0;

  const systemPrompt = buildTeachingSystemPrompt({
    phase,
    strategy,
    difficultyLevel: level,
    stepIndex: session.current_step_index,
    buildStepsTotal: session.build_steps_total,
    fadeLevel,
    ctx,
  });

  const response = await getClient().messages.create({
    model: TEACHING_MODEL,
    max_tokens: TEACHING_MAX_TOKENS,
    system: systemPrompt,
    messages: buildTurnMessages(session),
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "";
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  recordTeachingCost(
    { collegeId: ctx.collegeId, deptId: ctx.deptId, studentId: session.student_id, sessionId: session._id },
    TEACHING_MODEL,
    response.usage,
  ).catch(() => {}); // non-fatal — metering must never block a teaching turn

  let parsed: { content: string; check: PendingCheck | null };
  try {
    parsed = JSON.parse(stripFences(rawText));
  } catch {
    // Model didn't follow the JSON contract — degrade gracefully rather than
    // 500ing the whole turn; treat the raw text as content with no check.
    parsed = { content: rawText || "Let's continue.", check: phaseDef.hasCheck ? null : null };
  }

  const turn: TeachingTurn = {
    role: "assistant",
    phase,
    content: parsed.content,
    strategy,
    difficulty_level: level,
    check: phaseDef.hasCheck ? (parsed.check ?? null) : null,
    image_asset_id: phase === TeachingPhase.VISUALISE ? ctx.relevantImageAssetId : undefined,
  };

  return { turn, strategy, tokensUsed };
}

const EVAL_SYSTEM_PROMPT = `Evaluate a student's answer to a comprehension check during a
teaching session. Be generous about phrasing and terminology — judge whether the student
grasped the IDEA, not whether they used textbook wording. Respond ONLY with a valid JSON
object, no markdown, no preamble:
{
  "passed": true/false,
  "confidence": 0.0-1.0,
  "diagnosed_gap": "the specific thing they misunderstood, or null if passed",
  "matched_misconception_id": "id if their answer matches a known misconception, else null",
  "partial_credit": true/false,
  "encouragement_note": "one short phrase acknowledging what they DID get right"
}`;

export interface EvaluateCheckParams {
  studentResponse: string;
  check: PendingCheck;
  ctx: SessionContext;
  studentId: string;
  sessionId: string;
}

/** F-20-C §6.7 — grades a check response and (if it matches) flags a known
 * misconception, so the orchestrator can route into MISCONCEPTION_PROBE-style
 * handling even outside that phase. */
export async function evaluateCheckResponse(params: EvaluateCheckParams): Promise<{ evaluation: CheckEvaluation; tokensUsed: number }> {
  const { studentResponse, check, ctx, studentId, sessionId } = params;

  const userPrompt = `Concept being taught: ${ctx.concept.canonical_name}
Check question: "${check.question}"
Expected understanding: "${check.expected_answer}"
Student's answer: "${studentResponse}"

Known misconceptions for this concept (id: statement):
${ctx.misconceptions.map((m) => `- ${m._id}: ${m.statement}`).join("\n") || "(none recorded)"}`;

  const response = await getClient().messages.create({
    model: CHECK_EVAL_MODEL,
    max_tokens: 400,
    system: EVAL_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "";
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  recordTeachingCost(
    { collegeId: ctx.collegeId, deptId: ctx.deptId, studentId, sessionId },
    CHECK_EVAL_MODEL,
    response.usage,
  ).catch(() => {});

  let parsed: Partial<CheckEvaluation>;
  try {
    parsed = JSON.parse(stripFences(rawText));
  } catch {
    // Fail open rather than block the student on a malformed evaluator response.
    parsed = { passed: true, confidence: 0.3, diagnosed_gap: null, matched_misconception_id: null, partial_credit: false, encouragement_note: "" };
  }

  const evaluation: CheckEvaluation = {
    passed: !!parsed.passed,
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    diagnosed_gap: parsed.diagnosed_gap ?? null,
    matched_misconception_id: parsed.matched_misconception_id ?? null,
    partial_credit: !!parsed.partial_credit,
    encouragement_note: parsed.encouragement_note ?? "",
  };

  return { evaluation, tokensUsed };
}
