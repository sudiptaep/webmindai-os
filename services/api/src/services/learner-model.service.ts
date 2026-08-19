import { randomUUID } from "crypto";
import type { Connection } from "mongoose";
import type { ConceptMastery, ExplanationStrategy, LearnerModel } from "@college-chatbot/shared";
import { getLearnerModelModel } from "../models/college/learner-model.model";

const MASTERY_EWMA_ALPHA = Number(process.env.TEACHING_MASTERY_EWMA_ALPHA ?? 0.35);

// ── Pure update functions (F-20-E §8.4) — unit-testable without Mongo ──────

export interface CheckOutcome {
  passed: boolean;
  confidence: number;       // 0-1, the evaluator's confidence in its own judgement
  difficultyLevel: number;  // the rung the check was asked at
}

const DEFAULT_MASTERY: ConceptMastery = {
  confidence: 0.3,
  checks_passed: 0,
  checks_failed: 0,
  highest_level_passed: 0,
  sessions_count: 0,
};

/**
 * EWMA update of concept mastery from one check outcome. A pass contributes
 * its own confidence as signal; a fail contributes a small positive signal
 * scaled by (1 - confidence) — a low-confidence fail barely moves mastery
 * down, a high-confidence fail (evaluator sure the student got it wrong)
 * moves it down harder, matching the spec's intent that confident failure is
 * stronger evidence of a gap than an uncertain one.
 */
export function updateConceptMastery(
  prior: ConceptMastery | undefined,
  outcome: CheckOutcome,
  now: Date = new Date(),
): ConceptMastery {
  const base = prior ? { ...prior } : { ...DEFAULT_MASTERY };
  const signal = outcome.passed ? outcome.confidence : (1 - outcome.confidence) * 0.3;

  base.confidence = MASTERY_EWMA_ALPHA * signal + (1 - MASTERY_EWMA_ALPHA) * base.confidence;
  base.confidence = Math.max(0, Math.min(1, base.confidence));

  if (outcome.passed) {
    base.checks_passed += 1;
    base.highest_level_passed = Math.max(base.highest_level_passed, outcome.difficultyLevel);
    base.last_confirmed_at = now;
  } else {
    base.checks_failed += 1;
  }
  base.last_taught_at = now;

  return base;
}

/** Running mean of strategy pass rate — Welford-style incremental update, no history array needed. */
export function updateStrategySuccessRate(
  priorRate: number | undefined,
  priorCount: number | undefined,
  passed: boolean,
): { rate: number; count: number } {
  const count = (priorCount ?? 0) + 1;
  const rate = priorRate ?? 0.5;
  const updated = rate + ((passed ? 1 : 0) - rate) / count;
  return { rate: updated, count };
}

// ── Mongo-backed access ─────────────────────────────────────────────────────

export async function getOrCreateLearnerModel(
  conn: Connection,
  studentId: string,
  collegeId: string,
  deptId: string,
): Promise<LearnerModel> {
  const LearnerModelModel = getLearnerModelModel(conn);
  // Atomic upsert — a plain find-then-create races under concurrent calls for
  // the same student's first-ever interaction (e.g. a parent and its nested
  // backtrack session both building context near-simultaneously), and
  // student_id has a unique index, so the loser of that race would otherwise
  // throw an unhandled duplicate-key error instead of just getting the row
  // the winner created.
  const model = await LearnerModelModel.findOneAndUpdate(
    { student_id: studentId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        student_id: studentId,
        college_id: collegeId,
        dept_id: deptId,
        concept_mastery: {},
        held_misconceptions: [],
        strategy_success_rates: {},
        strategy_sample_counts: {},
        avg_checks_to_mastery: 0,
        avg_session_duration_minutes: 0,
        preferred_difficulty_entry_level: 2,
        total_teaching_sessions: 0,
        total_concepts_taught: 0,
        total_backtracks_triggered: 0,
      },
    },
    { upsert: true, new: true },
  ).lean();
  return model!;
}

export interface RecordCheckParams {
  studentId: string;
  collegeId: string;
  deptId: string;
  conceptId: string;
  strategy?: ExplanationStrategy;
  outcome: CheckOutcome;
  matchedMisconceptionId?: string | null;
}

/**
 * Applies one check outcome to a student's learner model: concept mastery
 * EWMA, strategy success running mean, and (if the answer matched a known
 * misconception) held_misconceptions tracking. Upserts the learner model if
 * it doesn't exist yet.
 */
export async function recordCheckOutcome(conn: Connection, params: RecordCheckParams): Promise<LearnerModel> {
  const { studentId, collegeId, deptId, conceptId, strategy, outcome, matchedMisconceptionId } = params;
  const LearnerModelModel = getLearnerModelModel(conn);

  const model = await getOrCreateLearnerModel(conn, studentId, collegeId, deptId);
  const now = new Date();

  const mastery = updateConceptMastery(model.concept_mastery[conceptId], outcome, now);

  const conceptMasteryPatch: Record<string, unknown> = { [`concept_mastery.${conceptId}`]: mastery };

  const setOps: Record<string, unknown> = { ...conceptMasteryPatch };

  if (strategy) {
    const { rate, count } = updateStrategySuccessRate(
      model.strategy_success_rates[strategy],
      model.strategy_sample_counts[strategy],
      outcome.passed,
    );
    setOps[`strategy_success_rates.${strategy}`] = rate;
    setOps[`strategy_sample_counts.${strategy}`] = count;
  }

  if (matchedMisconceptionId) {
    const existingHeld = model.held_misconceptions.find((m) => m.misconception_id === matchedMisconceptionId);
    if (existingHeld) {
      await LearnerModelModel.updateOne(
        { student_id: studentId, "held_misconceptions.misconception_id": matchedMisconceptionId },
        {
          $set: {
            ...setOps,
            "held_misconceptions.$.last_observed": now,
            "held_misconceptions.$.corrected": false,
          },
          $inc: { "held_misconceptions.$.times_observed": 1 },
        },
      );
    } else {
      await LearnerModelModel.updateOne(
        { student_id: studentId },
        {
          $set: setOps,
          $push: {
            held_misconceptions: {
              misconception_id: matchedMisconceptionId,
              concept_id: conceptId,
              first_observed: now,
              last_observed: now,
              times_observed: 1,
              corrected: false,
            },
          },
        },
      );
    }
  } else {
    await LearnerModelModel.updateOne({ student_id: studentId }, { $set: setOps });
  }

  const updated = await LearnerModelModel.findOne({ student_id: studentId }).lean();
  return updated!;
}

/** Marks a held misconception corrected once the post-correction check passes. */
export async function markMisconceptionCorrected(
  conn: Connection,
  studentId: string,
  misconceptionId: string,
): Promise<void> {
  const LearnerModelModel = getLearnerModelModel(conn);
  await LearnerModelModel.updateOne(
    { student_id: studentId, "held_misconceptions.misconception_id": misconceptionId },
    { $set: { "held_misconceptions.$.corrected": true, "held_misconceptions.$.corrected_at": new Date() } },
  );
}
