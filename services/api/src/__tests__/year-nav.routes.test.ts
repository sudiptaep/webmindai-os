import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-year';
const COLLEGE_ID = 'college-year-1';
const STUDENT_ID = 'student-year-1';
const DEPT_ID    = 'dept-year-1';

process.env.JWT_SECRET = JWT_SECRET;

function makeToken() {
  return jwt.sign(
    {
      sub:                   STUDENT_ID,
      role:                  'student',
      college_id:            COLLEGE_ID,
      college_type:          'medical',
      dept_id:               DEPT_ID,
      effective_dept_id:     DEPT_ID,
      using_generic_fallback: false,
      semester:              2,
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

// ─── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../db/college.db', () => ({
  getCollegeDb: vi.fn(async () => ({})),
}));

// Student model mock — returns a student with year/semester/SRS fields
const mockStudentDoc = {
  _id:                 STUDENT_ID,
  current_year:        2,
  current_semester:    3,
  srs_cards_due_today: 5,
  srs_streak_days:     7,
};

// Subject model mock — returns two subjects for year 2 / semester 3
const mockSubjects = [
  { _id: 'subj-1', name: 'Pathology',  code: 'PATH', year: 2, semester: 3, dept_id: DEPT_ID, disease_tags: ['tuberculosis'] },
  { _id: 'subj-2', name: 'Pharmacology', code: 'PHRM', year: 2, semester: 3, dept_id: DEPT_ID, disease_tags: [] },
];

// Document model mock — returns one doc per subject
const mockDocs = [
  { _id: 'doc-1', original_filename: 'Robbins.pdf', file_type: 'pdf',
    subject_id: 'subj-1', has_chapter_map: true, chapter_count: 30, page_count: 900 },
];

vi.mock('../models/college/student.model', () => ({
  getStudentModel: vi.fn(() => ({
    // Mongoose findById returns a query — must chain .lean()
    findById: vi.fn(() => ({ lean: vi.fn(async () => mockStudentDoc) })),
    updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
  })),
}));

vi.mock('../models/college/subject.model', () => ({
  getSubjectModel: vi.fn(() => ({
    // Mongoose find returns a query — must chain .lean()
    find: vi.fn(() => ({ lean: vi.fn(async () => mockSubjects) })),
  })),
}));

vi.mock('../models/college/document.model', () => ({
  getDocumentModel: vi.fn(() => ({
    find: vi.fn(() => ({
      select: vi.fn(function(this: unknown) { return this; }),
      lean:   vi.fn(async () => mockDocs),
    })),
  })),
}));

// ─── App factory ───────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { yearNavRoutes } = await import('../routes/year-nav.routes');
  await app.register(yearNavRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /student/my-year', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => { app = await buildApp(); token = makeToken(); });
  afterAll(() => app.close());

  it('returns 200 with student year data', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/college/${COLLEGE_ID}/student/my-year`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      student_year: number;
      student_semester: number;
      subjects: unknown[];
      srs_cards_due_today: number;
      study_streak: number;
    }>();
    expect(body.student_year).toBe(2);
    expect(body.student_semester).toBe(3);
    expect(body.srs_cards_due_today).toBe(5);
    expect(body.study_streak).toBe(7);
    expect(Array.isArray(body.subjects)).toBe(true);
  });

  it('returns subjects with doc chips', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/college/${COLLEGE_ID}/student/my-year`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json<{ subjects: Array<{ name: string; docs: unknown[] }> }>();
    const pathSubject = body.subjects.find(s => s.name === 'Pathology');
    expect(pathSubject).toBeDefined();
    expect(pathSubject?.docs).toHaveLength(1);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/college/${COLLEGE_ID}/student/my-year`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /student/update-year', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => { app = await buildApp(); token = makeToken(); });
  afterAll(() => app.close());

  it('returns 200 with updated year/semester', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/college/${COLLEGE_ID}/student/update-year`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ current_year: 3, current_semester: 5 }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ current_year: number; current_semester: number }>();
    expect(body.current_year).toBe(3);
    expect(body.current_semester).toBe(5);
  });

  it('rejects invalid year (year > 4)', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/college/${COLLEGE_ID}/student/update-year`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ current_year: 10, current_semester: 1 }),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects invalid semester (semester < 1)', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/college/${COLLEGE_ID}/student/update-year`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ current_year: 2, current_semester: 0 }),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
