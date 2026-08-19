import type { SessionContext } from "./types";

// ── F-20-C: Teaching State Machine — phase table ────────────────────────────

export enum TeachingPhase {
  DIAGNOSE            = 0,
  ANCHOR              = 1,
  SEGMENT_BUILD       = 2,
  VISUALISE           = 3,
  MODEL               = 4,
  GUIDED_PRACTICE     = 5,
  MISCONCEPTION_PROBE = 6,
  CLINICAL_CONNECT    = 7,
  FEYNMAN_CHECK       = 8,
  CONSOLIDATE         = 9,
}

export interface PhaseDefinition {
  phase: TeachingPhase;
  name: string;
  hasCheck: boolean;
  skippable: boolean;
  skipCondition?: (ctx: SessionContext) => boolean;
  maxTurns: number;
}

export const PHASE_DEFINITIONS: PhaseDefinition[] = [
  { phase: TeachingPhase.DIAGNOSE, name: "Diagnose", hasCheck: true, skippable: false, maxTurns: 3 },
  { phase: TeachingPhase.ANCHOR, name: "Anchor", hasCheck: false, skippable: false, maxTurns: 2 },
  { phase: TeachingPhase.SEGMENT_BUILD, name: "Build", hasCheck: true, skippable: false, maxTurns: 14 },
  {
    phase: TeachingPhase.VISUALISE, name: "Visualise", hasCheck: false, skippable: true, maxTurns: 2,
    skipCondition: (ctx) => !ctx.hasRelevantImage,
  },
  {
    phase: TeachingPhase.MODEL, name: "Worked example", hasCheck: false, skippable: true, maxTurns: 2,
    skipCondition: (ctx) => ["definition", "classification"].includes(ctx.concept.concept_type),
  },
  {
    phase: TeachingPhase.GUIDED_PRACTICE, name: "Guided practice", hasCheck: true, skippable: true, maxTurns: 8,
    skipCondition: (ctx) => ["definition", "classification"].includes(ctx.concept.concept_type),
  },
  {
    phase: TeachingPhase.MISCONCEPTION_PROBE, name: "Common error", hasCheck: true, skippable: true, maxTurns: 4,
    skipCondition: (ctx) => ctx.misconceptions.length === 0 || !ctx.teachingProfile.require_misconception_probe,
  },
  {
    phase: TeachingPhase.CLINICAL_CONNECT, name: "Why it matters", hasCheck: false, skippable: true, maxTurns: 2,
    skipCondition: (ctx) => !ctx.teachingProfile.always_include_clinical_connect && ctx.pyqCount === 0,
  },
  {
    phase: TeachingPhase.FEYNMAN_CHECK, name: "Explain it back", hasCheck: true, skippable: true, maxTurns: 3,
    skipCondition: (ctx) => !ctx.teachingProfile.require_feynman_check,
  },
  { phase: TeachingPhase.CONSOLIDATE, name: "Recap", hasCheck: false, skippable: false, maxTurns: 1 },
];

export function getPhaseDefinition(phase: number): PhaseDefinition {
  const def = PHASE_DEFINITIONS[phase];
  if (!def) throw new Error(`Unknown teaching phase index: ${phase}`);
  return def;
}

/** True if this phase should be skipped given the session's enabled_phases
 * restriction (nested/compressed sessions — F-20-C §6.4) or its own skip condition. */
export function shouldSkipPhase(phase: number, ctx: SessionContext, enabledPhases?: number[]): boolean {
  if (enabledPhases && !enabledPhases.includes(phase)) return true;
  const def = getPhaseDefinition(phase);
  return def.skippable && (def.skipCondition?.(ctx) ?? false);
}

/** First phase index > `from` that isn't skipped, or CONSOLIDATE (last) if none. */
export function nextNonSkippedPhase(from: number, ctx: SessionContext, enabledPhases?: number[]): number {
  for (let p = from + 1; p < PHASE_DEFINITIONS.length; p++) {
    if (!shouldSkipPhase(p, ctx, enabledPhases)) return p;
  }
  return TeachingPhase.CONSOLIDATE;
}

// ── Phase-specific prompt fragments ─────────────────────────────────────────

export const PHASE_INSTRUCTIONS: Record<TeachingPhase, string> = {
  [TeachingPhase.DIAGNOSE]: `
Your goal is to find out what this student already knows, WITHOUT making them
feel tested. Ask ONE question that probes a prerequisite concept, phrased in
everyday language rather than technical terminology. It should feel like
curiosity, not an exam. Do not teach anything yet.`,

  [TeachingPhase.ANCHOR]: `
Connect this concept to something the student has already demonstrated they
understand — ideally something from their answer in the previous turn. State
the core idea in ONE sentence, then signal that you will now build it up.
Do not go into mechanism yet.`,

  [TeachingPhase.SEGMENT_BUILD]: `
Teach step {step_index} of {total_steps} only. Keep it to 2-4 sentences.
Then ask ONE comprehension check question about THIS step only.
The check must be answerable from what you just said — do not test ahead.
Aim for a question the student has roughly an 80% chance of answering correctly.`,

  [TeachingPhase.VISUALISE]: `
A figure from the student's own textbook is being shown alongside your message.
Do not describe the whole image — the student can see it. Instead, direct their
attention: tell them exactly what to look at and what it demonstrates about the
concept. Reference the specific labels visible in the figure.`,

  [TeachingPhase.MODEL]: `
Work through ONE complete example from start to finish, thinking aloud.
Show your reasoning at each decision point, including why you rejected
alternatives. Explicitly tell the student to just follow along — they are not
solving this one. End by naming the pattern they should carry forward.`,

  [TeachingPhase.GUIDED_PRACTICE]: `
Give the student a similar problem to attempt, with scaffolding level {fade_level}:
  fade_level 2 → provide the full structure, they supply only the final step
  fade_level 1 → provide the first step, they complete the rest
  fade_level 0 → they attempt it unaided
Do not solve it for them. Wait for their attempt.`,

  [TeachingPhase.MISCONCEPTION_PROBE]: `
Students commonly believe: "{misconception_statement}"
Ask the diagnostic question: "{diagnostic_probe}"
If they answer consistent with the misconception, do NOT simply correct them.
First make the contradiction visible — show them a case their model cannot
explain. Then state the correct model plainly and re-check.`,

  [TeachingPhase.CLINICAL_CONNECT]: `
In 3-4 sentences, connect this concept to why it matters in practice.
If exam-frequency data is available, mention the exam relevance concretely.
Do not introduce new mechanism here.`,

  [TeachingPhase.FEYNMAN_CHECK]: `
Ask the student to explain this concept back to you in their own words, as if
teaching a junior student who has never encountered it. Emphasise that you want
their phrasing, not textbook phrasing. Wait for their explanation.`,

  [TeachingPhase.CONSOLIDATE]: `
Produce a structured recap:
  1. The concept in one sentence
  2. The 3 key points, each with its page citation
  3. The misconception that was addressed, restated as a warning (if any)
  4. What to review and when
Keep it scannable. This is what the student will screenshot.`,
};

// ── Difficulty ladder (F-20-E §8.1) ─────────────────────────────────────────

export enum DifficultyLevel {
  L0_DIRECT_TELL      = 0,
  L1_EVERYDAY_ANALOGY = 1,
  L2_CONCRETE_CASE    = 2,
  L3_ABSTRACT_FORMAL   = 3,
}

export const LEVEL_INSTRUCTIONS: Record<DifficultyLevel, string> = {
  [DifficultyLevel.L3_ABSTRACT_FORMAL]: `Use the formal, technical statement of
this concept, in the terminology the textbook uses. Assume the student can handle
precise language.`,

  [DifficultyLevel.L2_CONCRETE_CASE]: `Ground every claim in a specific concrete
case with real values. Introduce technical terms only after the concrete case has
made the idea clear.`,

  [DifficultyLevel.L1_EVERYDAY_ANALOGY]: `Explain using only everyday language and
an analogy from outside the subject entirely. Introduce at most ONE technical term,
and define it in the same sentence.`,

  [DifficultyLevel.L0_DIRECT_TELL]: `Do not question, do not build up. State the
key fact plainly. Then immediately restate it a second time in completely different
words. Then ask the student to repeat it back in their own words.`,
};
