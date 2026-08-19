import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted: any[] = [];
let existingTexts: string[] = [];
let studentIncrement = 0;

vi.mock('../models/college/srs-card.model', () => ({
  getSrsCardModel: () => ({
    find: () => ({
      lean: async () => existingTexts.map((t) => ({ question_text: t })),
    }),
    insertMany: vi.fn(async (docs: any[]) => { inserted.push(...docs); }),
  }),
}));

vi.mock('../models/college/student.model', () => ({
  getStudentModel: () => ({
    updateOne: vi.fn(async (_filter: any, update: any) => { studentIncrement += update.$inc.srs_total_cards; return { matchedCount: 1 }; }),
  }),
}));

vi.mock('../models/college/misconception.model', () => ({
  getMisconceptionModel: () => ({
    findById: (id: string) => ({
      lean: async () => (id === 'misc-1' ? {
        _id: 'misc-1',
        diagnostic_probe: 'What happens beyond optimal sarcomere length?',
        probe_correct_answer: 'Force decreases (descending limb)',
        correct_model: 'Force falls past optimal overlap',
        statement: 'More stretch always means more force',
      } : null),
    }),
  }),
}));

import { createSRSCardsFromSession } from '../services/teaching/srs-handoff';

function makeCtx() {
  return {
    concept: { canonical_name: 'Frank-Starling law', chapter_index: 12, source_pages: [218], bloom_ceiling: 'analyse' },
  } as any;
}

function makeCheck(passed: boolean, confidence: number, question: string) {
  return { question, expected_answer: `answer to ${question}`, passed, confidence, phase: 2, step_index: 0, partial_credit: false, difficulty_level: 2, timestamp: new Date() };
}

beforeEach(() => {
  inserted.length = 0;
  existingTexts = [];
  studentIncrement = 0;
  process.env.TEACHING_SRS_HANDOFF_ENABLED = 'true';
  process.env.TEACHING_SRS_CARDS_PER_SESSION = '3';
});

describe('createSRSCardsFromSession', () => {
  it('tags cards from hard checks with origin=teaching_session', async () => {
    const session = {
      _id: 'sess-1', student_id: 'stu-1', college_id: 'col-1', dept_id: 'dept-1', doc_id: 'doc-1', subject_id: 'subj-1',
      check_history: [makeCheck(false, 0.4, 'q1'), makeCheck(true, 0.9, 'q2'), makeCheck(false, 0.5, 'q3')],
    } as any;

    const ids = await createSRSCardsFromSession({} as any, session, makeCtx());

    expect(ids.length).toBe(2); // only the two failed/low-confidence checks qualify
    expect(inserted.every((c) => c.origin === 'teaching_session')).toBe(true);
    expect(inserted.every((c) => c.origin_session_id === 'sess-1')).toBe(true);
    expect(studentIncrement).toBe(2);
  });

  it('caps at TEACHING_SRS_CARDS_PER_SESSION, keeping the hardest (lowest-confidence) checks', async () => {
    process.env.TEACHING_SRS_CARDS_PER_SESSION = '2';
    const session = {
      _id: 'sess-2', student_id: 'stu-1', college_id: 'col-1', dept_id: 'dept-1', doc_id: 'doc-1', subject_id: 'subj-1',
      check_history: [makeCheck(false, 0.6, 'q-mid'), makeCheck(false, 0.1, 'q-hardest'), makeCheck(false, 0.3, 'q-hard')],
    } as any;

    await createSRSCardsFromSession({} as any, session, makeCtx());

    expect(inserted.length).toBe(2);
    expect(inserted.map((c) => c.question_text)).toEqual(['q-hardest', 'q-hard']);
  });

  it('always adds one card for the corrected misconception, tagged separately', async () => {
    const session = {
      _id: 'sess-3', student_id: 'stu-1', college_id: 'col-1', dept_id: 'dept-1', doc_id: 'doc-1', subject_id: 'subj-1',
      check_history: [],
      misconception_addressed_id: 'misc-1',
    } as any;

    const ids = await createSRSCardsFromSession({} as any, session, makeCtx());

    expect(ids.length).toBe(1);
    expect(inserted[0].origin).toBe('teaching_session_misconception');
    expect(inserted[0].question_text).toContain('optimal sarcomere length');
  });

  it('dedupes against cards the student already has for this chapter', async () => {
    existingTexts = ['q1'];
    const session = {
      _id: 'sess-4', student_id: 'stu-1', college_id: 'col-1', dept_id: 'dept-1', doc_id: 'doc-1', subject_id: 'subj-1',
      check_history: [makeCheck(false, 0.4, 'q1'), makeCheck(false, 0.4, 'q2')],
    } as any;

    const ids = await createSRSCardsFromSession({} as any, session, makeCtx());

    expect(ids.length).toBe(1);
    expect(inserted[0].question_text).toBe('q2');
  });

  it('creates nothing when there are no hard checks and no corrected misconception', async () => {
    const session = {
      _id: 'sess-5', student_id: 'stu-1', college_id: 'col-1', dept_id: 'dept-1', doc_id: 'doc-1', subject_id: 'subj-1',
      check_history: [makeCheck(true, 0.95, 'easy-q')],
    } as any;

    const ids = await createSRSCardsFromSession({} as any, session, makeCtx());
    expect(ids).toEqual([]);
    expect(inserted.length).toBe(0);
  });

  it('is a no-op when TEACHING_SRS_HANDOFF_ENABLED=false', async () => {
    process.env.TEACHING_SRS_HANDOFF_ENABLED = 'false';
    const session = {
      _id: 'sess-6', student_id: 'stu-1', college_id: 'col-1', dept_id: 'dept-1', doc_id: 'doc-1', subject_id: 'subj-1',
      check_history: [makeCheck(false, 0.1, 'q1')],
    } as any;

    const ids = await createSRSCardsFromSession({} as any, session, makeCtx());
    expect(ids).toEqual([]);
    expect(inserted.length).toBe(0);
  });
});
