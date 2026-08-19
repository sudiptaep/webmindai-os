import type { AnalogyPolicy, ConceptType, ExplanationStrategy, MnemonicPolicy } from "@college-chatbot/shared";

// ── F-20-D: Explanation Strategy Engine ─────────────────────────────────────

export const STRATEGY_MAP: Record<ConceptType, ExplanationStrategy[]> = {
  process_mechanism: [
    "visual_spatial", "first_principles", "extreme_case", "narrative_history", "analogy",
  ],
  structure_anatomy: [
    "visual_spatial", "analogy", "mnemonic", "contrast_pair", "concrete_instance",
  ],
  law_relationship: [
    "first_principles", "extreme_case", "worked_example", "analogy", "visual_spatial",
  ],
  classification: [
    "contrast_pair", "mnemonic", "concrete_instance", "visual_spatial",
  ],
  procedure_calculation: [
    "worked_example", "error_analysis", "concrete_instance", "first_principles",
  ],
  causal_chain: [
    "narrative_history", "visual_spatial", "concrete_instance", "extreme_case",
  ],
  definition: [
    "contrast_pair", "concrete_instance", "mnemonic",
  ],
};

// Strategies that are actively unhelpful for certain concept types
export const STRATEGY_ANTIPATTERNS: Record<ConceptType, ExplanationStrategy[]> = {
  process_mechanism:     ["mnemonic"],        // hides the logic
  structure_anatomy:     ["first_principles"],
  law_relationship:      ["narrative_history"],
  classification:        ["extreme_case"],
  procedure_calculation: ["analogy"],
  causal_chain:          ["mnemonic"],
  definition:            ["extreme_case"],
};

export interface SelectStrategyParams {
  conceptType: ConceptType;
  hasRelevantImage: boolean;
  strategiesFailed: ExplanationStrategy[];
  strategiesAttempted: ExplanationStrategy[];
  analogyPolicy: AnalogyPolicy;
  mnemonicPolicy: MnemonicPolicy;
  strategySuccessRates: Partial<Record<ExplanationStrategy, number>>;
  strategyPreferenceOrder: ExplanationStrategy[];
}

/**
 * Picks the explanation strategy for the next teaching turn. Priority, in
 * order: never a strategy that already failed this session; prefer one not
 * yet tried this session; fall back to VISUAL_SPATIAL exclusion when no
 * image is available; then rank by (this student's historical success rate,
 * faculty's preference order) as tiebreakers.
 */
export function selectStrategy(params: SelectStrategyParams): ExplanationStrategy {
  const {
    conceptType, hasRelevantImage, strategiesFailed, strategiesAttempted,
    analogyPolicy, mnemonicPolicy, strategySuccessRates, strategyPreferenceOrder,
  } = params;

  // Eligibility pool: strategies structurally valid for this concept type,
  // independent of session history. Availability/policy constraints are
  // applied here — BEFORE the failed/attempted exhaustion logic below —
  // so an exhaustion fallback can never resurrect a strategy that's
  // unavailable (no image) or policy-forbidden.
  const antipatterns = STRATEGY_ANTIPATTERNS[conceptType];
  let pool = STRATEGY_MAP[conceptType].filter((s) => !antipatterns.includes(s));
  if (!hasRelevantImage) pool = pool.filter((s) => s !== "visual_spatial");
  if (analogyPolicy === "avoid") pool = pool.filter((s) => s !== "analogy");
  if (mnemonicPolicy === "only_for_lists" && conceptType !== "classification") {
    pool = pool.filter((s) => s !== "mnemonic");
  }
  if (pool.length === 0) pool = ["concrete_instance"];

  let candidates = pool
    .filter((s) => !strategiesFailed.includes(s))
    .filter((s) => !strategiesAttempted.includes(s));

  // Exhausted untried options — allow attempted-but-not-failed strategies back in
  if (candidates.length === 0) {
    candidates = pool.filter((s) => !strategiesFailed.includes(s));
  }
  // Every eligible strategy in the pool has already failed this session —
  // universal safe fallback rather than crash on an empty candidate list.
  if (candidates.length === 0) candidates = ["concrete_instance"];

  // Learner preference: strategies that historically worked for this student
  candidates = [...candidates].sort(
    (a, b) => (strategySuccessRates[b] ?? 0.5) - (strategySuccessRates[a] ?? 0.5),
  );

  // Faculty ordering as a tiebreaker (stable sort preserves the learner-pref
  // ordering among strategies the faculty list doesn't mention)
  const facultyOrder = strategyPreferenceOrder ?? [];
  candidates = [...candidates].sort((a, b) => {
    const ai = facultyOrder.indexOf(a), bi = facultyOrder.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return candidates[0];
}

export const STRATEGY_INSTRUCTIONS: Record<ExplanationStrategy, string> = {
  analogy: `Explain by mapping this onto a familiar everyday domain the student
already understands. Make the mapping explicit — state which part of the analogy
corresponds to which part of the concept. Then state where the analogy BREAKS
DOWN, so they do not over-extend it.`,

  first_principles: `Build this up from something the student already accepts as
true. Start from the foundational relationship and derive forward, one logical
step at a time. Do not assert the conclusion — arrive at it.`,

  worked_example: `Demonstrate with one complete concrete instance. Narrate your
reasoning at each step, including why you chose this approach over alternatives.
Use real numbers or a real case, not placeholders.`,

  contrast_pair: `Define this by explicit contrast with the concept students most
often confuse it with. Structure it as: "X is ___. Y is ___. The difference is
___." Make the distinguishing feature unmistakable.`,

  concrete_instance: `Move from the abstract statement to one specific, vivid,
concrete case. Use actual values, an actual patient presentation, or an actual
circuit. Specificity is what makes this work.`,

  visual_spatial: `A figure from the student's textbook accompanies this message.
Direct their attention to specific parts of it. Use spatial language — above,
below, flowing into, branching from. Reference the visible labels by name.`,

  extreme_case: `Push a variable to its limit and ask what happens. Extremes make
mechanisms visible in a way that normal ranges do not. Then bring it back to the
physiological or operational range.`,

  error_analysis: `Present a plausible but incorrect line of reasoning and ask the
student to identify where it goes wrong. This works only if they already partly
grasp the concept — use it to consolidate, not to introduce.`,

  narrative_history: `Tell the story of how this was discovered or figured out.
Who, when, what problem they were trying to solve, what surprised them. Keep it
to 3-4 sentences and land on the insight itself.`,

  mnemonic: `Provide a memory device for the arbitrary, order-dependent, or
list-based part of this concept. Be explicit that the mnemonic aids RECALL only —
it is not a substitute for understanding the underlying logic.`,
};
