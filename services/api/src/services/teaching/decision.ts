import type { CheckHistoryEntry, TeachingSession } from "@college-chatbot/shared";
import type { Decision, SessionContext } from "./types";
import { TeachingPhase, getPhaseDefinition, nextNonSkippedPhase } from "./phases";

const COMPRESS_THRESHOLD = Number(process.env.TEACHING_COMPRESS_THRESHOLD ?? 0.90);
const PREREQ_CONFIRMED_THRESHOLD = Number(process.env.TEACHING_PREREQ_CONFIRMED_THRESHOLD ?? 0.65);
const GUIDED_PRACTICE_FADE_STEPS = 3; // fade_level 2 -> 1 -> 0, i.e. step_index 0,1,2

/** Just the slice of TeachingSession state the pure decision logic needs. */
export type DecisionSessionState = Pick<
  TeachingSession,
  | "check_history" | "current_difficulty_level" | "current_phase" | "phase_turn_count"
  | "build_steps_remaining" | "current_step_index" | "backtrack_active" | "enabled_phases"
  | "backtrack_stack"
>;

/** The outcome of a check evaluated on THIS call — null if no check was just
 * answered (first call of a session, or the current phase has no check and
 * hasn't produced its one turn yet). Kept separate from `check_history`
 * (which is global, cross-phase, and used only for the backtrack/compression
 * trend signals) so a stale result from a *previous* phase's check can never
 * be mistaken for "the current phase's check just failed". */
export interface JustEvaluated {
  passed: boolean;
}

/**
 * Picks the next teaching-loop action. Pure — no I/O, no LLM calls — so the
 * full decision tree (rung drops, backtrack triggers, phase compression,
 * maxTurns guard) is unit-testable without mocking Anthropic or Mongo.
 */
export function decideNextAction(
  session: DecisionSessionState,
  ctx: SessionContext,
  justEvaluated: JustEvaluated | null = null,
): Decision {
  const recentChecks = session.check_history.slice(-4);
  const rollingSuccess = recentChecks.length
    ? recentChecks.filter((c) => c.passed).length / recentChecks.length
    : 1.0;

  const phaseDef = getPhaseDefinition(session.current_phase);

  // ── Session already at CONSOLIDATE and its one turn has been produced ──
  if (session.current_phase === TeachingPhase.CONSOLIDATE && session.phase_turn_count >= 1) {
    return { action: "COMPLETE_SESSION" };
  }

  // ── Back-track: three straight failures means a missing prerequisite ───
  // Scoped to checks recorded AFTER the most recent backtrack resolved —
  // otherwise the same 3 failures that triggered a backtrack are still
  // sitting at the end of check_history when the parent resumes, and would
  // immediately re-trigger a second backtrack before the student has even
  // had a fresh attempt.
  const lastBacktrackOpenedAt = session.backtrack_stack.at(-1)?.opened_at;
  const historySinceLastBacktrack = lastBacktrackOpenedAt
    ? session.check_history.filter((c) => c.timestamp > lastBacktrackOpenedAt)
    : session.check_history;
  const last3 = historySinceLastBacktrack.slice(-3);
  if (last3.length === 3 && last3.every((c) => !c.passed) && !session.backtrack_active) {
    const missingPrereq = inferMissingPrerequisite(session.check_history, ctx);
    if (missingPrereq) {
      return { action: "BACKTRACK_PREREQUISITE", prerequisiteId: missingPrereq };
    }
  }

  // ── The check just answered THIS call failed → drop a rung and retry ───
  if (justEvaluated && !justEvaluated.passed) {
    if (session.current_difficulty_level > 0) {
      return { action: "RETRY_LOWER_RUNG", newLevel: session.current_difficulty_level - 1 };
    }
    // Already at L0 — accept and move on rather than looping forever
    return nextStepOrPhase(session, ctx);
  }

  // ── Guard against runaway phases ────────────────────────────────────────
  if (session.phase_turn_count >= phaseDef.maxTurns) {
    return { action: "ADVANCE_PHASE", nextPhase: nextNonSkippedPhase(session.current_phase, ctx, session.enabled_phases) };
  }

  // ── Strong performance in SEGMENT_BUILD → compress remaining steps ──────
  if (justEvaluated?.passed && rollingSuccess >= COMPRESS_THRESHOLD && session.current_phase === TeachingPhase.SEGMENT_BUILD) {
    const compressed = Math.max(1, Math.floor(session.build_steps_remaining / 2));
    const inner = nextStepOrPhase({ ...session, build_steps_remaining: compressed }, ctx);
    // Only ADVANCE_STEP carries build_steps_remaining state — if compression
    // pushed the count down to where the phase is actually exhausted,
    // `inner` is an ADVANCE_PHASE and there's nothing left to persist.
    return inner.action === "ADVANCE_STEP" ? { action: "ADVANCE_STEP", setBuildStepsRemaining: compressed } : inner;
  }

  // ── No check was just answered: are we still owed this phase's turn? ───
  if (!justEvaluated) {
    // A single-turn (no-check) phase that hasn't produced its turn yet, or
    // the very first call of a session — just generate it, no state change.
    if (session.phase_turn_count === 0) return { action: "CONTINUE" };
    // A no-check phase that already showed its one turn — move on.
    if (!phaseDef.hasCheck) return nextStepOrPhase(session, ctx);
    // A check-having phase with no fresh evaluation and turns already
    // produced (e.g. still awaiting the student's answer) — nothing to do.
    return { action: "CONTINUE" };
  }

  // justEvaluated.passed === true
  return nextStepOrPhase(session, ctx);
}

/** Advance within the current phase (more build steps / practice fade levels
 * left) or move to the next non-skipped phase. */
export function nextStepOrPhase(session: DecisionSessionState, ctx: SessionContext): Decision {
  const phase = session.current_phase;

  if (phase === TeachingPhase.SEGMENT_BUILD && session.build_steps_remaining > 1) {
    return { action: "ADVANCE_STEP" };
  }
  if (phase === TeachingPhase.GUIDED_PRACTICE && session.current_step_index < GUIDED_PRACTICE_FADE_STEPS - 1) {
    return { action: "ADVANCE_STEP" };
  }

  return { action: "ADVANCE_PHASE", nextPhase: nextNonSkippedPhase(phase, ctx, session.enabled_phases) };
}

/**
 * Which prerequisite is most likely the actual gap, given three straight
 * check failures. Prefers a prerequisite whose confidence is unconfirmed AND
 * whose name overlaps with what the evaluator diagnosed as the gap; falls
 * back to the first unconfirmed prerequisite in graph order.
 */
export function inferMissingPrerequisite(
  checkHistory: CheckHistoryEntry[],
  ctx: SessionContext,
): string | null {
  const unconfirmedIds = ctx.concept.prerequisite_ids.filter((pid) => {
    const mastery = ctx.learnerModel.concept_mastery[pid];
    return !mastery || mastery.confidence < PREREQ_CONFIRMED_THRESHOLD;
  });
  if (unconfirmedIds.length === 0) return null;
  if (unconfirmedIds.length === 1) return unconfirmedIds[0];

  const diagnosedGaps = checkHistory
    .slice(-3)
    .map((c) => c.diagnosed_gap)
    .filter((g): g is string => Boolean(g))
    .join(" ")
    .toLowerCase();

  if (!diagnosedGaps) return unconfirmedIds[0];

  const nameById = new Map(ctx.concept.prerequisite_ids.map((id, i) => [id, ctx.concept.prerequisite_names[i]]));
  const scored = unconfirmedIds
    .map((id) => {
      const name = (nameById.get(id) ?? "").toLowerCase();
      const words = name.split(/\W+/).filter((w) => w.length > 3);
      const score = words.filter((w) => diagnosedGaps.includes(w)).length;
      return { id, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0].score > 0 ? scored[0].id : unconfirmedIds[0];
}
