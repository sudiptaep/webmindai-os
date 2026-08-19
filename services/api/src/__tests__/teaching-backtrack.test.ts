import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── In-memory fake TeachingSession collection ──────────────────────────────
// Mongoose Document semantics we actually rely on: create() returns a live,
// mutable object with .save(); findOne() returns THE SAME object reference
// (so mutate-then-save from a later call is visible), not a fresh clone.

const sessionStore = new Map<string, any>();

function fakeDoc(data: any) {
  const doc: any = { ...data };
  doc.save = vi.fn(async () => doc);
  sessionStore.set(doc._id, doc);
  return doc;
}

const TeachingSessionModelMock = {
  create: vi.fn(async (data: any) => fakeDoc(data)),
  findOne: vi.fn(async (filter: any) => {
    const doc = sessionStore.get(filter._id);
    if (!doc) return null;
    if (filter.student_id && doc.student_id !== filter.student_id) return null;
    if (filter.college_id && doc.college_id !== filter.college_id) return null;
    return doc;
  }),
  updateOne: vi.fn(async (filter: any, update: any) => {
    const doc = sessionStore.get(filter._id);
    if (!doc) return { matchedCount: 0 };
    const prereqId = filter['backtrack_stack.prerequisite_concept_id'];
    if (prereqId) {
      const entry = doc.backtrack_stack.find((e: any) => e.prerequisite_concept_id === prereqId && !e.closed_at);
      if (entry && update.$set) entry.closed_at = update.$set['backtrack_stack.$.closed_at'];
    }
    if (update.$set?.backtrack_active !== undefined) doc.backtrack_active = update.$set.backtrack_active;
    return { matchedCount: 1 };
  }),
};

vi.mock('../models/college/teaching-session.model', () => ({
  getTeachingSessionModel: () => TeachingSessionModelMock,
}));

vi.mock('../models/college/misconception.model', () => ({
  getMisconceptionModel: () => ({ updateOne: vi.fn(async () => ({ matchedCount: 1 })) }),
}));

vi.mock('../models/college/learner-model.model', () => ({
  getLearnerModelModel: () => ({ updateOne: vi.fn(async () => ({ matchedCount: 1 })) }),
}));

vi.mock('../services/learner-model.service', () => ({
  recordCheckOutcome: vi.fn(async () => {}),
  markMisconceptionCorrected: vi.fn(async () => {}),
  getOrCreateLearnerModel: vi.fn(async () => ({})),
}));

// ─── Canned teaching context — bypasses Concept/Profile/LearnerModel/Pinecone ──

let maxBacktrackDepth = 2;
let confirmedPrereqs: Set<string> = new Set();

function makeCtx(conceptId: string) {
  const isPrereq = conceptId === 'prereq-1';
  return {
    collegeId: 'college-1', deptId: 'dept-1', deptName: 'Physiology',
    concept: {
      _id: conceptId,
      canonical_name: isPrereq ? 'Sarcomere overlap' : 'Frank-Starling law',
      concept_type: 'law_relationship',
      one_line_definition: 'x',
      chapter_index: isPrereq ? 9 : 12,
      source_pages: [1],
      prerequisite_ids: isPrereq ? [] : ['prereq-1'],
      prerequisite_names: isPrereq ? [] : ['Sarcomere overlap'],
      bloom_ceiling: 'understand',
      difficulty_rating: 0.5,
      is_examinable: true,
      pyq_frequency: 0,
    },
    teachingProfile: {
      analogy_policy: 'sparing', mnemonic_policy: 'only_for_lists', rigour_level: 'balanced',
      always_include_clinical_connect: false, require_feynman_check: false, require_misconception_probe: false,
      strategy_preference_order: [], max_backtrack_depth: maxBacktrackDepth, custom_instruction: '',
    },
    learnerModel: {
      concept_mastery: Object.fromEntries([...confirmedPrereqs].map((id) => [id, { confidence: 0.9 }])),
      held_misconceptions: [], strategy_success_rates: {}, strategy_sample_counts: {},
    },
    misconceptions: [], hasRelevantImage: false, groundingChunks: [{ page_num: 1, text: 'x' }],
  };
}

vi.mock('../services/teaching/context', () => ({
  buildSessionContext: vi.fn(async (_conn: any, session: any) => makeCtx(session.concept_id)),
  getConcept: vi.fn(async (_conn: any, conceptId: string) => makeCtx(conceptId).concept),
}));

// ─── Canned turn generation / check evaluation ─────────────────────────────

let nextEvalPassed = true;
let nextEvalDiagnosedGap: string | null = null;

vi.mock('../services/teaching/generate', () => ({
  generatePhaseTurn: vi.fn(async ({ session }: any) => {
    // Mirror the real hasCheck table for the phases this test exercises.
    const HAS_CHECK: Record<number, boolean> = { 0: true, 1: false, 2: true, 3: false, 9: false };
    const check = HAS_CHECK[session.current_phase]
      ? { question: 'q', expected_answer: 'a', bloom_level: 'understand' }
      : null;
    return {
      turn: { role: 'assistant', phase: session.current_phase, content: `turn@${session.current_phase}`, check },
      strategy: 'concrete_instance',
      tokensUsed: 10,
    };
  }),
  evaluateCheckResponse: vi.fn(async () => ({
    evaluation: {
      passed: nextEvalPassed,
      confidence: 0.8,
      diagnosed_gap: nextEvalDiagnosedGap,
      matched_misconception_id: null,
      partial_credit: false,
      encouragement_note: '',
    },
    tokensUsed: 5,
  })),
}));

// ─── Import under test (after mocks are registered) ────────────────────────

import { createTeachingSession } from '../services/teaching/session.service';
import { advanceTeachingSession } from '../services/teaching/orchestrator';
import { TeachingPhase } from '../services/teaching/phases';

const CONN = {} as any;
const COLLEGE_ID = 'college-1';

beforeEach(() => {
  sessionStore.clear();
  maxBacktrackDepth = 2;
  confirmedPrereqs = new Set();
  nextEvalPassed = true;
  nextEvalDiagnosedGap = null;
});

async function driveToPhase(sessionId: string, targetPhase: number, maxSteps = 30) {
  let turn = await advanceTeachingSession(CONN, sessionId, COLLEGE_ID, 'ack');
  let steps = 0;
  while (sessionStore.get(sessionId).current_phase !== targetPhase && steps < maxSteps) {
    turn = await advanceTeachingSession(CONN, sessionId, COLLEGE_ID, 'ack');
    steps++;
  }
  return turn;
}

describe('teaching backtrack — end to end (mocked LLM + Mongo)', () => {
  it('backtracks after 3 straight SEGMENT_BUILD failures, then resumes the parent once the nested session completes', async () => {
    const parent = await createTeachingSession(CONN, {
      studentId: 'student-1', conceptId: 'frank-starling', collegeId: COLLEGE_ID, deptId: 'dept-1', docId: 'doc-1',
    });

    // DIAGNOSE (pass) -> ANCHOR (no check, one turn) -> SEGMENT_BUILD
    nextEvalPassed = true;
    await driveToPhase(parent._id, TeachingPhase.SEGMENT_BUILD);
    expect(sessionStore.get(parent._id).current_phase).toBe(TeachingPhase.SEGMENT_BUILD);

    // Three straight failures on the build check, each diagnosing the prerequisite gap
    nextEvalPassed = false;
    nextEvalDiagnosedGap = 'does not understand sarcomere overlap';
    let turn = await advanceTeachingSession(CONN, parent._id, COLLEGE_ID, 'wrong 1'); // -> RETRY_LOWER_RUNG L1
    turn = await advanceTeachingSession(CONN, parent._id, COLLEGE_ID, 'wrong 2');      // -> RETRY_LOWER_RUNG L0
    turn = await advanceTeachingSession(CONN, parent._id, COLLEGE_ID, 'wrong 3');      // -> BACKTRACK_PREREQUISITE

    expect(turn.is_backtrack_notice).toBe(true);
    expect(turn.nested_session_id).toBeTruthy();
    const parentDoc = sessionStore.get(parent._id);
    expect(parentDoc.backtrack_active).toBe(true);
    expect(parentDoc.backtracks_triggered).toBe(1);
    expect(parentDoc.awaiting_check_response).toBe(false); // stale check cleared

    const nestedId = turn.nested_session_id!;
    const nestedDoc = sessionStore.get(nestedId);
    expect(nestedDoc.is_nested).toBe(true);
    expect(nestedDoc.parent_session_id).toBe(parent._id);
    expect(nestedDoc.concept_id).toBe('prereq-1');

    // Drive the nested (compressed) session to completion, passing every check.
    nextEvalPassed = true;
    let resumedTurn = null;
    for (let i = 0; i < 30 && !resumedTurn; i++) {
      const t = await advanceTeachingSession(CONN, nestedId, COLLEGE_ID, 'ack');
      if (t.resume_parent_session_id) resumedTurn = t;
    }

    expect(resumedTurn).not.toBeNull();
    expect(resumedTurn!.resume_parent_session_id).toBe(parent._id);
    expect(sessionStore.get(nestedId).status).toBe('completed');

    // Parent's backtrack entry is resolved and it picked up its own next turn.
    const parentAfter = sessionStore.get(parent._id);
    expect(parentAfter.backtrack_active).toBe(false);
    expect(parentAfter.backtrack_stack[0].closed_at).toBeTruthy();
  });

  it('refuses a second backtrack once max_backtrack_depth is reached', async () => {
    maxBacktrackDepth = 1;
    const parent = await createTeachingSession(CONN, {
      studentId: 'student-2', conceptId: 'frank-starling', collegeId: COLLEGE_ID, deptId: 'dept-1', docId: 'doc-1',
    });

    nextEvalPassed = true;
    await driveToPhase(parent._id, TeachingPhase.SEGMENT_BUILD);

    nextEvalPassed = false;
    nextEvalDiagnosedGap = 'sarcomere overlap gap';
    await advanceTeachingSession(CONN, parent._id, COLLEGE_ID, 'wrong 1');
    await advanceTeachingSession(CONN, parent._id, COLLEGE_ID, 'wrong 2');
    const firstBacktrack = await advanceTeachingSession(CONN, parent._id, COLLEGE_ID, 'wrong 3');
    expect(firstBacktrack.is_backtrack_notice).toBe(true);
    expect(sessionStore.get(parent._id).backtracks_triggered).toBe(1);

    // Immediately try to force a second backtrack on the same (still L0, still
    // failing) parent — depth cap should refuse it.
    const secondAttempt = await advanceTeachingSession(CONN, parent._id, COLLEGE_ID, 'wrong 4');
    expect(secondAttempt.is_backtrack_notice).toBeFalsy();
    expect(secondAttempt.nested_session_id).toBeFalsy();
    expect(sessionStore.get(parent._id).backtracks_triggered).toBe(1); // unchanged
  });
});
