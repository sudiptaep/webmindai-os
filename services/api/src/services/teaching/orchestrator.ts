import type { Connection } from "mongoose";
import { getTeachingSessionModel } from "../../models/college/teaching-session.model";
import { getMisconceptionModel } from "../../models/college/misconception.model";
import { recordCheckOutcome, markMisconceptionCorrected } from "../learner-model.service";
import { getLearnerModelModel } from "../../models/college/learner-model.model";
import { buildSessionContext, getConcept } from "./context";
import { decideNextAction, type DecisionSessionState } from "./decision";
import { generatePhaseTurn, evaluateCheckResponse } from "./generate";
import { createTeachingSession, loadSessionDoc } from "./session.service";
import { createSRSCardsFromSession } from "./srs-handoff";
import { TeachingPhase } from "./phases";
import type { SessionContext, TeachingTurn } from "./types";

const BUILD_STEPS_DEFAULT = Number(process.env.TEACHING_BUILD_STEPS_DEFAULT ?? 4);
const MAX_BACKTRACK_DEPTH_FALLBACK = Number(process.env.TEACHING_MAX_BACKTRACK_DEPTH ?? 2);

function toDecisionState(session: DecisionSessionState): DecisionSessionState {
  return {
    check_history: session.check_history,
    current_difficulty_level: session.current_difficulty_level,
    current_phase: session.current_phase,
    phase_turn_count: session.phase_turn_count,
    build_steps_remaining: session.build_steps_remaining,
    current_step_index: session.current_step_index,
    backtrack_active: session.backtrack_active,
    enabled_phases: session.enabled_phases,
    backtrack_stack: session.backtrack_stack,
  };
}

/**
 * The teaching-loop entry point (F-20-C §6.2). Evaluates the student's
 * response to any pending check, decides the next state-machine action, and
 * generates the resulting turn. One call = one round trip.
 */
export async function advanceTeachingSession(
  conn: Connection,
  sessionId: string,
  collegeId: string,
  studentResponse: string | null,
): Promise<TeachingTurn> {
  const session = await loadSessionDoc(conn, sessionId, collegeId);
  const ctx = await buildSessionContext(conn, session);

  if (studentResponse) {
    session.turns.push({ role: "student", phase: session.current_phase, content: studentResponse, created_at: new Date() });
  }

  // ── 1. Evaluate the student's response to the previous check, if any ────
  let justEvaluated: { passed: boolean } | null = null;
  if (studentResponse && session.awaiting_check_response && session.pending_check) {
    const { evaluation, tokensUsed } = await evaluateCheckResponse({
      studentResponse,
      check: session.pending_check,
      ctx,
      studentId: session.student_id,
      sessionId: session._id,
    });
    session.tokens_used += tokensUsed;
    justEvaluated = { passed: evaluation.passed };

    session.check_history.push({
      phase: session.current_phase,
      step_index: session.current_step_index,
      question: session.pending_check.question,
      expected_answer: session.pending_check.expected_answer,
      student_answer: studentResponse,
      passed: evaluation.passed,
      confidence: evaluation.confidence,
      partial_credit: evaluation.partial_credit,
      difficulty_level: session.current_difficulty_level,
      strategy_used: session.current_strategy,
      diagnosed_gap: evaluation.diagnosed_gap ?? undefined,
      matched_misconception_id: evaluation.matched_misconception_id ?? undefined,
      timestamp: new Date(),
    });
    session.total_checks += 1;
    if (evaluation.passed) session.checks_passed += 1;

    if (!evaluation.passed && session.current_strategy) {
      if (!session.strategies_failed.includes(session.current_strategy)) {
        session.strategies_failed.push(session.current_strategy);
      }
    }

    await recordCheckOutcome(conn, {
      studentId: session.student_id,
      collegeId,
      deptId: session.dept_id,
      conceptId: session.concept_id,
      strategy: session.current_strategy,
      outcome: { passed: evaluation.passed, confidence: evaluation.confidence, difficultyLevel: session.current_difficulty_level },
      matchedMisconceptionId: evaluation.matched_misconception_id,
    });

    // Misconception probe outcome tracking (F-20-B §5.4)
    if (session.current_phase === TeachingPhase.MISCONCEPTION_PROBE && ctx.currentMisconception) {
      const Misconception = getMisconceptionModel(conn);
      await Misconception.updateOne(
        { _id: ctx.currentMisconception._id },
        { $inc: { times_probed: 1, times_corrected: evaluation.passed ? 1 : 0 } },
      );
      if (evaluation.passed) {
        session.misconception_addressed_id = ctx.currentMisconception._id;
        session.misconception_corrected = true;
        await markMisconceptionCorrected(conn, session.student_id, ctx.currentMisconception._id);
      }
    }
  }

  // ── 2. Decide what happens next ──────────────────────────────────────
  // (max_backtrack_depth is enforced inside openNestedPrerequisiteSession,
  // at the point the BACKTRACK_PREREQUISITE action is actually carried out)
  const decision = decideNextAction(toDecisionState(session), ctx, justEvaluated);

  switch (decision.action) {
    case "CONTINUE":
      break;
    case "BACKTRACK_PREREQUISITE": {
      const turn = await openNestedPrerequisiteSession(conn, session, decision.prerequisiteId, collegeId);
      await session.save();
      return turn;
    }
    case "RETRY_LOWER_RUNG":
      session.current_difficulty_level = decision.newLevel;
      session.rungs_dropped += 1;
      session.current_strategy = undefined; // force re-selection, excluding the just-failed strategy
      break;
    case "ADVANCE_STEP":
      session.current_step_index += 1;
      if (session.current_phase === TeachingPhase.SEGMENT_BUILD) {
        session.build_steps_remaining = decision.setBuildStepsRemaining ?? Math.max(0, session.build_steps_remaining - 1);
      }
      break;
    case "ADVANCE_PHASE":
      session.current_phase = decision.nextPhase;
      session.current_step_index = 0;
      session.phase_turn_count = 0;
      session.strategies_failed = [];
      session.strategies_attempted = [];
      session.current_strategy = undefined;
      if (decision.nextPhase === TeachingPhase.SEGMENT_BUILD) {
        session.build_steps_total = BUILD_STEPS_DEFAULT;
        session.build_steps_remaining = BUILD_STEPS_DEFAULT;
      }
      break;
    case "COMPLETE_SESSION": {
      const turn = await closeSession(conn, session, ctx);
      await session.save();
      return turn;
    }
  }

  // ── 3. Generate the turn for the (possibly new) phase ────────────────
  const { turn, strategy, tokensUsed } = await generatePhaseTurn({ session, ctx });
  session.tokens_used += tokensUsed;
  session.current_strategy = strategy;
  if (!session.strategies_attempted.includes(strategy)) session.strategies_attempted.push(strategy);

  session.turns.push({
    role: "assistant",
    phase: session.current_phase,
    content: turn.content,
    strategy: turn.strategy,
    difficulty_level: turn.difficulty_level,
    image_asset_id: turn.image_asset_id,
    created_at: new Date(),
  });

  session.awaiting_check_response = turn.check !== null;
  session.pending_check = turn.check;
  session.turn_count += 1;
  session.phase_turn_count += 1;

  await session.save();
  return turn;
}

async function openNestedPrerequisiteSession(
  conn: Connection,
  parentSession: Awaited<ReturnType<typeof loadSessionDoc>>,
  prerequisiteId: string,
  collegeId: string,
): Promise<TeachingTurn> {
  const maxDepth = (await buildSessionContext(conn, parentSession)).teachingProfile.max_backtrack_depth ?? MAX_BACKTRACK_DEPTH_FALLBACK;
  if (parentSession.backtracks_triggered >= maxDepth) {
    // Depth cap reached — accept current understanding and move on rather
    // than backtrack again.
    parentSession.current_difficulty_level = Math.max(0, parentSession.current_difficulty_level - 1);
    const ctx = await buildSessionContext(conn, parentSession);
    const { turn, strategy, tokensUsed } = await generatePhaseTurn({ session: parentSession, ctx });
    parentSession.tokens_used += tokensUsed;
    parentSession.current_strategy = strategy;
    parentSession.turns.push({ role: "assistant", phase: parentSession.current_phase, content: turn.content, strategy: turn.strategy, difficulty_level: turn.difficulty_level, created_at: new Date() });
    parentSession.awaiting_check_response = turn.check !== null;
    parentSession.pending_check = turn.check;
    parentSession.turn_count += 1;
    parentSession.phase_turn_count += 1;
    return turn;
  }

  const prereq = await getConcept(conn, prerequisiteId);
  const parentCtx = await buildSessionContext(conn, parentSession);

  // Clear the stale pending check — it already failed and was recorded; the
  // parent should not come back expecting another answer to it once resumed.
  parentSession.awaiting_check_response = false;
  parentSession.pending_check = null;

  parentSession.backtrack_active = true;
  parentSession.backtracks_triggered += 1;
  parentSession.backtrack_stack.push({
    prerequisite_concept_id: prerequisiteId,
    parent_phase: parentSession.current_phase,
    parent_step_index: parentSession.current_step_index,
    opened_at: new Date(),
  });

  const nestedSession = await createTeachingSession(conn, {
    studentId: parentSession.student_id,
    conceptId: prerequisiteId,
    collegeId,
    deptId: parentSession.dept_id,
    docId: parentSession.doc_id,
    subjectId: parentSession.subject_id,
    parentSessionId: parentSession._id,
    isNested: true,
    enabledPhases: [TeachingPhase.ANCHOR, TeachingPhase.SEGMENT_BUILD, TeachingPhase.VISUALISE],
    initialDifficultyLevel: 1,
  });

  const nestedCtx = await buildSessionContext(conn, nestedSession);
  const { turn: nestedTurn, strategy, tokensUsed } = await generatePhaseTurn({ session: nestedSession, ctx: nestedCtx });
  nestedSession.tokens_used += tokensUsed;
  nestedSession.current_strategy = strategy;
  nestedSession.strategies_attempted = [strategy];
  nestedSession.turns.push({ role: "assistant", phase: nestedSession.current_phase, content: nestedTurn.content, strategy: nestedTurn.strategy, difficulty_level: nestedTurn.difficulty_level, created_at: new Date() });
  nestedSession.awaiting_check_response = nestedTurn.check !== null;
  nestedSession.pending_check = nestedTurn.check;
  nestedSession.turn_count = 1;
  nestedSession.phase_turn_count = 1;
  await nestedSession.save();

  return {
    role: "assistant",
    phase: TeachingPhase.ANCHOR,
    is_backtrack_notice: true,
    content:
      `Let's pause here. I think the gap is one step earlier — **${prereq.canonical_name}**. ` +
      `Once that clicks, ${parentCtx.concept.canonical_name} follows naturally. ` +
      `Give me two minutes on it.\n\n${nestedTurn.content}`,
    check: nestedTurn.check,
    nested_session_id: nestedSession._id,
  };
}

/** Wraps up a session: computes final mastery, rolls aggregate stats into
 * the learner model, seeds SRS cards from the hardest checks (F-20-C §10.4),
 * and (for a nested session) resolves the parent's backtrack so it can
 * continue on its next advance call. */
async function closeSession(
  conn: Connection,
  session: Awaited<ReturnType<typeof loadSessionDoc>>,
  ctx: SessionContext,
): Promise<TeachingTurn> {
  session.status = "completed";
  session.completed_at = new Date();
  session.duration_seconds = Math.round((session.completed_at.getTime() - session.started_at.getTime()) / 1000);
  session.final_mastery_estimate = ctx.learnerModel.concept_mastery[session.concept_id]?.confidence ?? undefined;

  const lastAssistantTurn = [...session.turns].reverse().find((t) => t.role === "assistant");
  session.consolidation_summary = lastAssistantTurn?.content ?? "";

  // F-20-C §10.4: SRS hand-off — only for the primary concept session, not
  // the compressed prerequisite mini-lessons opened by a backtrack.
  if (!session.is_nested) {
    session.srs_cards_created = await createSRSCardsFromSession(conn, session, ctx);
  }

  const LearnerModelModel = getLearnerModelModel(conn);
  await LearnerModelModel.updateOne(
    { student_id: session.student_id },
    {
      $inc: {
        total_teaching_sessions: 1,
        total_concepts_taught: session.is_nested ? 0 : 1,
        total_backtracks_triggered: session.backtracks_triggered,
      },
    },
  );

  if (session.is_nested && session.parent_session_id) {
    const TeachingSessionModel = getTeachingSessionModel(conn);
    await TeachingSessionModel.updateOne(
      { _id: session.parent_session_id, "backtrack_stack.prerequisite_concept_id": session.concept_id, "backtrack_stack.closed_at": { $exists: false } },
      {
        $set: {
          backtrack_active: false,
          "backtrack_stack.$.closed_at": new Date(),
        },
      },
    );

    // Resume the parent immediately — its awaiting_check_response/pending_check
    // were already cleared when the backtrack opened (see
    // openNestedPrerequisiteSession), so this regenerates the parent's next
    // turn (typically a fresh attempt at the build step it was failing)
    // rather than leaving the student stranded on the nested session.
    const parentTurn = await advanceTeachingSession(conn, session.parent_session_id, session.college_id, null);

    return {
      ...parentTurn,
      content: `**${session.consolidation_summary || "That's the gap covered."}**\n\nOkay — back to where we were.\n\n${parentTurn.content}`,
      nested_session_id: session._id,
      resume_parent_session_id: session.parent_session_id,
    };
  }

  return {
    role: "assistant",
    phase: session.current_phase,
    content: session.consolidation_summary,
    check: null,
    is_session_complete: true,
    srs_cards_created: session.srs_cards_created.length,
  };
}
