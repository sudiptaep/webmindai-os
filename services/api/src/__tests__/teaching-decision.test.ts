import { describe, it, expect } from 'vitest';
import { decideNextAction, inferMissingPrerequisite, type DecisionSessionState } from '../services/teaching/decision';
import { TeachingPhase, PHASE_DEFINITIONS, shouldSkipPhase, nextNonSkippedPhase } from '../services/teaching/phases';
import type { SessionContext } from '../services/teaching/types';
import type { CheckHistoryEntry, Concept, LearnerModel, TeachingProfile } from '@college-chatbot/shared';

function makeConcept(overrides: Partial<Concept> = {}): Concept {
  return {
    _id: 'concept-1',
    college_id: 'c1',
    dept_id: 'd1',
    doc_id: 'doc1',
    canonical_name: 'Frank-Starling law',
    aliases: [],
    concept_type: 'law_relationship',
    one_line_definition: 'Force scales with fibre length',
    chapter_index: 12,
    source_pages: [218, 219],
    prerequisite_ids: ['prereq-sarcomere', 'prereq-preload'],
    prerequisite_names: ['Sarcomere overlap', 'Preload'],
    bloom_ceiling: 'analyse',
    difficulty_rating: 0.7,
    is_examinable: true,
    pyq_frequency: 0,
    extraction_method: 'llm_chapter_pass',
    reviewed_by_faculty: false,
    concept_graph_version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeTeachingProfile(overrides: Partial<TeachingProfile> = {}): TeachingProfile {
  return {
    _id: 'tp1', college_id: 'c1', dept_id: 'd1',
    strategy_preference_order: [],
    analogy_policy: 'sparing', mnemonic_policy: 'only_for_lists', rigour_level: 'balanced',
    always_include_clinical_connect: true, require_feynman_check: true, require_misconception_probe: true,
    default_bloom_target: 'apply', default_entry_difficulty: 2, max_session_minutes: 20, max_backtrack_depth: 2,
    custom_instruction: '', updated_at: new Date(),
    ...overrides,
  };
}

function makeLearnerModel(overrides: Partial<LearnerModel> = {}): LearnerModel {
  return {
    _id: 'lm1', student_id: 's1', college_id: 'c1', dept_id: 'd1',
    concept_mastery: {}, held_misconceptions: [],
    strategy_success_rates: {}, strategy_sample_counts: {},
    avg_checks_to_mastery: 0, avg_session_duration_minutes: 0, preferred_difficulty_entry_level: 2,
    total_teaching_sessions: 0, total_concepts_taught: 0, total_backtracks_triggered: 0,
    updated_at: new Date(),
    ...overrides,
  };
}

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    collegeId: 'c1', deptId: 'd1', deptName: 'Physiology',
    concept: makeConcept(), teachingProfile: makeTeachingProfile(), learnerModel: makeLearnerModel(),
    misconceptions: [], hasRelevantImage: false, groundingChunks: [{ page_num: 218, text: 'x' }],
    pyqCount: 0, pyqSampleExams: [],
    ...overrides,
  };
}

function makeCheck(passed: boolean, overrides: Partial<CheckHistoryEntry> = {}): CheckHistoryEntry {
  return {
    phase: TeachingPhase.SEGMENT_BUILD, step_index: 0, question: 'q', expected_answer: 'a',
    student_answer: 'x', passed, confidence: 0.8, partial_credit: false, difficulty_level: 2,
    timestamp: new Date(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<DecisionSessionState> = {}): DecisionSessionState {
  return {
    check_history: [], current_difficulty_level: 2, current_phase: TeachingPhase.SEGMENT_BUILD,
    phase_turn_count: 1, build_steps_remaining: 4, current_step_index: 0, backtrack_active: false,
    backtrack_stack: [],
    ...overrides,
  };
}

describe('decideNextAction — first turn / no-check phases', () => {
  it('CONTINUEs on the very first call of a session (phase_turn_count 0, nothing evaluated)', () => {
    const session = makeSession({ current_phase: TeachingPhase.DIAGNOSE, phase_turn_count: 0, check_history: [] });
    const d = decideNextAction(session, makeCtx(), null);
    expect(d).toEqual({ action: 'CONTINUE' });
  });

  it('advances phase once a no-check phase (e.g. ANCHOR) has already shown its turn', () => {
    const session = makeSession({ current_phase: TeachingPhase.ANCHOR, phase_turn_count: 1, check_history: [] });
    const d = decideNextAction(session, makeCtx(), null);
    expect(d.action).toBe('ADVANCE_PHASE');
  });

  it('CONTINUEs a check-having phase awaiting an answer (no fresh evaluation this call)', () => {
    const session = makeSession({ current_phase: TeachingPhase.DIAGNOSE, phase_turn_count: 1, check_history: [] });
    const d = decideNextAction(session, makeCtx(), null);
    expect(d).toEqual({ action: 'CONTINUE' });
  });
});

describe('decideNextAction — difficulty rung drops', () => {
  it('drops from L3 to L2 when the just-evaluated check failed', () => {
    const session = makeSession({ current_difficulty_level: 3, check_history: [makeCheck(false)] });
    const d = decideNextAction(session, makeCtx(), { passed: false });
    expect(d).toEqual({ action: 'RETRY_LOWER_RUNG', newLevel: 2 });
  });

  it('drops from L2 to L1 to L0 across consecutive failures', () => {
    let level = 3;
    for (const expected of [2, 1, 0]) {
      const session = makeSession({ current_difficulty_level: level, check_history: [makeCheck(false)] });
      const d = decideNextAction(session, makeCtx(), { passed: false });
      expect(d).toEqual({ action: 'RETRY_LOWER_RUNG', newLevel: expected });
      level = expected;
    }
  });

  it('at L0, a failed check advances instead of retrying (no rung left)', () => {
    const session = makeSession({ current_difficulty_level: 0, check_history: [makeCheck(false)], build_steps_remaining: 3 });
    const d = decideNextAction(session, makeCtx(), { passed: false });
    expect(d.action).toBe('ADVANCE_STEP');
  });

  it('a passed check never triggers a rung drop', () => {
    const session = makeSession({ current_difficulty_level: 2, check_history: [makeCheck(true)] });
    const d = decideNextAction(session, makeCtx(), { passed: true });
    expect(d.action).not.toBe('RETRY_LOWER_RUNG');
  });
});

describe('decideNextAction — backtrack trigger', () => {
  it('triggers BACKTRACK_PREREQUISITE after 3 straight failures with an unconfirmed prerequisite', () => {
    const session = makeSession({
      current_difficulty_level: 0,
      check_history: [makeCheck(false), makeCheck(false), makeCheck(false)],
    });
    const d = decideNextAction(session, makeCtx(), { passed: false });
    expect(d.action).toBe('BACKTRACK_PREREQUISITE');
  });

  it('does not backtrack if already mid-backtrack', () => {
    const session = makeSession({
      current_difficulty_level: 0,
      check_history: [makeCheck(false), makeCheck(false), makeCheck(false)],
      backtrack_active: true,
    });
    const d = decideNextAction(session, makeCtx(), { passed: false });
    expect(d.action).not.toBe('BACKTRACK_PREREQUISITE');
  });

  it('does not backtrack if all prerequisites are already confirmed', () => {
    const ctx = makeCtx({
      learnerModel: makeLearnerModel({
        concept_mastery: {
          'prereq-sarcomere': { confidence: 0.9, checks_passed: 5, checks_failed: 0, highest_level_passed: 3, sessions_count: 1 },
          'prereq-preload': { confidence: 0.9, checks_passed: 5, checks_failed: 0, highest_level_passed: 3, sessions_count: 1 },
        },
      }),
    });
    const session = makeSession({
      current_difficulty_level: 0,
      check_history: [makeCheck(false), makeCheck(false), makeCheck(false)],
    });
    const d = decideNextAction(session, ctx, { passed: false });
    expect(d.action).not.toBe('BACKTRACK_PREREQUISITE');
  });
});

describe('decideNextAction — maxTurns guard', () => {
  it('force-advances the phase once phase_turn_count reaches maxTurns, even with nothing evaluated', () => {
    const anchorMax = PHASE_DEFINITIONS[TeachingPhase.ANCHOR].maxTurns;
    const session = makeSession({
      current_phase: TeachingPhase.ANCHOR,
      phase_turn_count: anchorMax,
      check_history: [],
    });
    const d = decideNextAction(session, makeCtx(), null);
    expect(d.action).toBe('ADVANCE_PHASE');
  });

  it('does not runaway past maxTurns — the guard fires exactly at the boundary', () => {
    const buildMax = PHASE_DEFINITIONS[TeachingPhase.SEGMENT_BUILD].maxTurns;
    const session = makeSession({
      current_phase: TeachingPhase.SEGMENT_BUILD,
      phase_turn_count: buildMax - 1,
      build_steps_remaining: 10, // would otherwise keep advancing steps forever
      check_history: [makeCheck(false), makeCheck(true), makeCheck(true), makeCheck(true)], // 75% rolling — below compression threshold
    });
    const d = decideNextAction(session, makeCtx(), { passed: true });
    // one turn below the cap: normal step advance, not yet forced
    expect(d.action).toBe('ADVANCE_STEP');

    const atCap = makeSession({ ...session, phase_turn_count: buildMax });
    const d2 = decideNextAction(atCap, makeCtx(), { passed: true });
    expect(d2.action).toBe('ADVANCE_PHASE');
  });
});

describe('decideNextAction — phase/step progression', () => {
  it('advances step within SEGMENT_BUILD while steps remain (below the compression threshold)', () => {
    const session = makeSession({
      build_steps_remaining: 3,
      check_history: [makeCheck(false), makeCheck(true), makeCheck(true), makeCheck(true)],
    });
    const d = decideNextAction(session, makeCtx(), { passed: true });
    expect(d).toEqual({ action: 'ADVANCE_STEP' });
  });

  it('advances phase once SEGMENT_BUILD steps are exhausted', () => {
    const session = makeSession({
      build_steps_remaining: 1,
      check_history: [makeCheck(false), makeCheck(true), makeCheck(true), makeCheck(true)],
    });
    const d = decideNextAction(session, makeCtx(), { passed: true });
    expect(d.action).toBe('ADVANCE_PHASE');
  });

  it('compresses SEGMENT_BUILD steps when rolling success is very high', () => {
    const passes = [makeCheck(true), makeCheck(true), makeCheck(true), makeCheck(true)];
    const session = makeSession({ build_steps_remaining: 4, check_history: passes, phase_turn_count: 2 });
    const d = decideNextAction(session, makeCtx(), { passed: true });
    expect(['ADVANCE_STEP', 'ADVANCE_PHASE']).toContain(d.action);
  });

  it('reaches COMPLETE_SESSION once CONSOLIDATE has produced its turn', () => {
    const session = makeSession({ current_phase: TeachingPhase.CONSOLIDATE, phase_turn_count: 1, check_history: [] });
    const d = decideNextAction(session, makeCtx(), null);
    expect(d).toEqual({ action: 'COMPLETE_SESSION' });
  });

  it('CONTINUEs into CONSOLIDATE\'s own first turn before completing', () => {
    const session = makeSession({ current_phase: TeachingPhase.CONSOLIDATE, phase_turn_count: 0, check_history: [] });
    const d = decideNextAction(session, makeCtx(), null);
    expect(d).toEqual({ action: 'CONTINUE' });
  });
});

describe('phase skip logic', () => {
  it('skips VISUALISE when there is no relevant image', () => {
    const ctx = makeCtx({ hasRelevantImage: false });
    expect(shouldSkipPhase(TeachingPhase.VISUALISE, ctx)).toBe(true);
  });

  it('does not skip VISUALISE when an image is available', () => {
    const ctx = makeCtx({ hasRelevantImage: true });
    expect(shouldSkipPhase(TeachingPhase.VISUALISE, ctx)).toBe(false);
  });

  it('skips MODEL and GUIDED_PRACTICE for definition/classification concepts', () => {
    const ctx = makeCtx({ concept: makeConcept({ concept_type: 'definition' }) });
    expect(shouldSkipPhase(TeachingPhase.MODEL, ctx)).toBe(true);
    expect(shouldSkipPhase(TeachingPhase.GUIDED_PRACTICE, ctx)).toBe(true);
  });

  it('skips MISCONCEPTION_PROBE when there are no misconceptions for the concept', () => {
    const ctx = makeCtx({ misconceptions: [] });
    expect(shouldSkipPhase(TeachingPhase.MISCONCEPTION_PROBE, ctx)).toBe(true);
  });

  it('respects enabled_phases for a nested (compressed) session', () => {
    const ctx = makeCtx();
    const enabled = [TeachingPhase.ANCHOR, TeachingPhase.SEGMENT_BUILD, TeachingPhase.VISUALISE];
    expect(shouldSkipPhase(TeachingPhase.MODEL, ctx, enabled)).toBe(true);
    expect(shouldSkipPhase(TeachingPhase.SEGMENT_BUILD, ctx, enabled)).toBe(false);
  });

  it('nextNonSkippedPhase always terminates at CONSOLIDATE even in a compressed session', () => {
    const ctx = makeCtx({ hasRelevantImage: true });
    const enabled = [TeachingPhase.ANCHOR, TeachingPhase.SEGMENT_BUILD, TeachingPhase.VISUALISE];
    const next = nextNonSkippedPhase(TeachingPhase.VISUALISE, ctx, enabled);
    expect(next).toBe(TeachingPhase.CONSOLIDATE);
  });
});

describe('inferMissingPrerequisite', () => {
  it('returns the only unconfirmed prerequisite when just one exists', () => {
    const ctx = makeCtx({
      learnerModel: makeLearnerModel({
        concept_mastery: { 'prereq-sarcomere': { confidence: 0.9, checks_passed: 3, checks_failed: 0, highest_level_passed: 2, sessions_count: 1 } },
      }),
    });
    const result = inferMissingPrerequisite([], ctx);
    expect(result).toBe('prereq-preload');
  });

  it('returns null once every prerequisite is confirmed', () => {
    const ctx = makeCtx({
      learnerModel: makeLearnerModel({
        concept_mastery: {
          'prereq-sarcomere': { confidence: 0.9, checks_passed: 3, checks_failed: 0, highest_level_passed: 2, sessions_count: 1 },
          'prereq-preload': { confidence: 0.8, checks_passed: 3, checks_failed: 0, highest_level_passed: 2, sessions_count: 1 },
        },
      }),
    });
    expect(inferMissingPrerequisite([], ctx)).toBeNull();
  });

  it('prefers the prerequisite whose name matches the diagnosed gap text', () => {
    const ctx = makeCtx();
    const history: CheckHistoryEntry[] = [
      makeCheck(false, { diagnosed_gap: 'does not understand preload and venous return' }),
    ];
    expect(inferMissingPrerequisite(history, ctx)).toBe('prereq-preload');
  });
});
