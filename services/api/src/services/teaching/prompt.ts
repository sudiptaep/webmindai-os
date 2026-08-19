import type { ExplanationStrategy } from "@college-chatbot/shared";
import { STRATEGY_INSTRUCTIONS } from "../strategy.service";
import { PHASE_INSTRUCTIONS, LEVEL_INSTRUCTIONS, TeachingPhase, getPhaseDefinition, type DifficultyLevel } from "./phases";
import type { SessionContext } from "./types";

function topStrategies(ctx: SessionContext): string {
  const entries = Object.entries(ctx.learnerModel.strategy_success_rates ?? {}) as Array<[ExplanationStrategy, number]>;
  const withSamples = entries.filter(([s]) => (ctx.learnerModel.strategy_sample_counts?.[s] ?? 0) >= 2);
  if (withSamples.length === 0) return "not enough history yet";
  return withSamples
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, rate]) => `${s} (${Math.round(rate * 100)}%)`)
    .join(", ");
}

function confirmedPrereqs(ctx: SessionContext): string {
  const names = ctx.concept.prerequisite_ids
    .map((pid, i) => {
      const mastery = ctx.learnerModel.concept_mastery[pid];
      return mastery && mastery.confidence >= 0.65 ? ctx.concept.prerequisite_names[i] : null;
    })
    .filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(", ") : "none confirmed yet";
}

function heldMisconceptionsNote(ctx: SessionContext): string {
  const held = ctx.learnerModel.held_misconceptions.filter(
    (m) => m.concept_id === ctx.concept._id && !m.corrected,
  );
  if (held.length === 0) return "";
  return `- This student has previously shown this exact misconception and has not yet corrected it — watch for it.`;
}

export interface BuildPromptParams {
  phase: TeachingPhase;
  strategy: ExplanationStrategy;
  difficultyLevel: DifficultyLevel;
  stepIndex: number;
  buildStepsTotal: number;
  fadeLevel: number;
  ctx: SessionContext;
}

/** F-20-F §9.3 — the full system prompt for one teaching turn, grounded in
 * retrieved source chunks and shaped by phase, strategy, difficulty rung,
 * department teaching profile, and this student's learner model. */
export function buildTeachingSystemPrompt(params: BuildPromptParams): string {
  const { phase, strategy, difficultyLevel, stepIndex, buildStepsTotal, fadeLevel, ctx } = params;
  const { concept, teachingProfile, currentMisconception, groundingChunks, deptName } = ctx;

  let phaseInstructions = PHASE_INSTRUCTIONS[phase]
    .replace("{step_index}", String(stepIndex + 1))
    .replace("{total_steps}", String(buildStepsTotal))
    .replace("{fade_level}", String(fadeLevel));

  if (phase === TeachingPhase.MISCONCEPTION_PROBE && currentMisconception) {
    phaseInstructions = phaseInstructions
      .replace("{misconception_statement}", currentMisconception.statement)
      .replace("{diagnostic_probe}", currentMisconception.diagnostic_probe);
  }
  if (phase === TeachingPhase.CLINICAL_CONNECT) {
    phaseInstructions += ctx.pyqCount > 0
      ? `\nExam relevance: this concept appeared in ${ctx.pyqCount} past-year question(s)${
          ctx.pyqSampleExams.length ? `, including ${ctx.pyqSampleExams.join(", ")}` : ""
        }. Mention this concretely.`
      : `\nNo past-year question data for this concept — do not fabricate exam-frequency claims.`;
  }

  return `You are teaching a ${deptName || "student"} one concept, one step at a time.
You are NOT answering a question — you are running a structured teaching session.

CONCEPT: ${concept.canonical_name}
Definition: ${concept.one_line_definition}
Type: ${concept.concept_type}

SOURCE MATERIAL — everything you say must be grounded in this:
${groundingChunks.map((c) => `[Page ${c.page_num}] ${c.text}`).join("\n\n")}

CURRENT PHASE: ${phase}
${phaseInstructions}

EXPLANATION STRATEGY: ${strategy}
${STRATEGY_INSTRUCTIONS[strategy]}

DIFFICULTY LEVEL: L${difficultyLevel}
${LEVEL_INSTRUCTIONS[difficultyLevel]}

${currentMisconception ? `MISCONCEPTION IN PLAY:
Students commonly believe: "${currentMisconception.statement}"
Correct model: "${currentMisconception.correct_model}"` : ""}

DEPARTMENT TEACHING PROFILE:
- Rigour: ${teachingProfile.rigour_level}
- Analogies: ${teachingProfile.analogy_policy}
- Mnemonics: ${teachingProfile.mnemonic_policy}
${teachingProfile.custom_instruction ? `- Faculty instruction: ${teachingProfile.custom_instruction}` : ""}

WHAT YOU KNOW ABOUT THIS STUDENT:
- Strategies that work well for them: ${topStrategies(ctx)}
- Prerequisite concepts confirmed: ${confirmedPrereqs(ctx)}
${heldMisconceptionsNote(ctx)}

HARD RULES:
- Never exceed 5 sentences before pausing for the student.
- Every factual claim must cite its page: "— Page X".
- Never invent content not present in the source material above.
- If the student's answer is partly right, say what was right BEFORE correcting.
- Never say "as I mentioned" or "as we discussed" — students find it condescending.
- Do not move to the next step until the current check is answered.

RESPONSE FORMAT — respond ONLY with a valid JSON object, no markdown, no preamble:
{
  "content": "your teaching turn, following the rules above",
  "check": ${phaseHasCheck(phase) ? `{ "question": "the comprehension check question", "expected_answer": "what a passing answer looks like", "bloom_level": "remember|understand|apply|analyse" }` : "null"}
}`;
}

function phaseHasCheck(phase: TeachingPhase): boolean {
  return getPhaseDefinition(phase).hasCheck;
}
