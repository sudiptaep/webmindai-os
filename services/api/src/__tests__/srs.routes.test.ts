import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const JWT_SECRET    = 'test-secret-srs';
const COLLEGE_ID    = 'college-test-1';
const STUDENT_ID    = 'student-test-1';
const DEPT_ID       = 'dept-test-1';
const CARD_ID       = 'card-test-1';

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

const mockSrsCardModel = {
  updateOne: vi.fn(async () => ({ matchedCount: 1 })),
  deleteOne:  vi.fn(async () => ({ deletedCount: 1 })),
};

vi.mock('../models/college/srs-card.model', () => ({
  getSrsCardModel: vi.fn(() => mockSrsCardModel),
}));

vi.mock('../models/college/student.model', () => ({
  getStudentModel: vi.fn(() => ({
    updateOne: vi.fn(async () => ({})),
  })),
}));

const mockGetDueTodayCards = vi.fn();
const mockReviewCard       = vi.fn();
const mockAddManualCard    = vi.fn();
const mockGetSRSStats      = vi.fn();

vi.mock('../services/srs.service', () => ({
  getDueTodayCards: (...args: unknown[]) => mockGetDueTodayCards(...args),
  reviewCard:       (...args: unknown[]) => mockReviewCard(...args),
  addManualCard:    (...args: unknown[]) => mockAddManualCard(...args),
  getSRSStats:      (...args: unknown[]) => mockGetSRSStats(...args),
}));

// ─── App factory ───────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { srsRoutes } = await import('../routes/srs.routes');
  await app.register(srsRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /srs/due-today', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app   = await buildApp();
    token = makeToken();
  });
  afterAll(() => app.close());

  it('returns 200 with cards array', async () => {
    mockGetDueTodayCards.mockResolvedValueOnce({
      cards:        [],
      total_due:    0,
      total_active: 5,
      streak:       3,
    });

    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/due-today`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ cards: unknown[]; total_due: number; streak: number }>();
    expect(body.cards).toEqual([]);
    expect(body.total_due).toBe(0);
    expect(body.streak).toBe(3);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/college/${COLLEGE_ID}/student/srs/due-today`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 if college_id in token mismatches URL', async () => {
    const wrongToken = jwt.sign(
      { sub: STUDENT_ID, role: 'student', college_id: 'other-college',
        college_type: 'medical', dept_id: DEPT_ID, effective_dept_id: DEPT_ID,
        using_generic_fallback: false, semester: 2 },
      JWT_SECRET, { expiresIn: '1h' },
    );
    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/due-today`,
      headers: { authorization: `Bearer ${wrongToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /srs/stats', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => { app = await buildApp(); token = makeToken(); });
  afterAll(() => app.close());

  it('returns 200 with all stat fields', async () => {
    const mockStats = {
      total_cards: 25, active_cards: 20, graduated_cards: 5,
      due_today: 3, streak: 7, avg_ease_factor: 2.45, retention_rate_pct: 82,
    };
    mockGetSRSStats.mockResolvedValueOnce(mockStats);

    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/stats`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof mockStats>();
    expect(body.streak).toBe(7);
    expect(body.retention_rate_pct).toBe(82);
    expect(body.active_cards).toBe(20);
  });
});

describe('POST /srs/review', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => { app = await buildApp(); token = makeToken(); });
  afterAll(() => app.close());

  it('returns 200 with SM-2 result for valid quality score', async () => {
    const mockResult = {
      interval_days: 8,
      next_review_at: new Date(Date.now() + 8 * 86400_000),
      ease_factor: 2.6,
      streak: 4,
    };
    mockReviewCard.mockResolvedValueOnce(mockResult);

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/review`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ card_id: CARD_ID, quality: 5, time_taken_seconds: 12 }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ interval_days: number; streak: number }>();
    expect(body.interval_days).toBe(8);
    expect(body.streak).toBe(4);
  });

  it('returns 500 when body is missing card_id (Zod parse error)', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/review`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ quality: 3 }),
    });
    // Zod parse failure surfaces as 500 (uncaught error in handler)
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('passes quality=0 (Again) without error', async () => {
    mockReviewCard.mockResolvedValueOnce({ interval_days: 1, next_review_at: new Date(), ease_factor: 1.7, streak: 0 });
    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/review`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ card_id: CARD_ID, quality: 0, time_taken_seconds: 45 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ interval_days: number }>();
    expect(body.interval_days).toBe(1);
  });
});

describe('PATCH /srs/cards/:cardId/suspend', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => { app = await buildApp(); token = makeToken(); });
  afterAll(() => app.close());

  beforeEach(() => {
    mockSrsCardModel.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it('returns 200 ok true when card exists', async () => {
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/cards/${CARD_ID}/suspend`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('returns 404 when card not found for this student', async () => {
    mockSrsCardModel.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/cards/nonexistent-card/suspend`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /srs/cards/:cardId', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => { app = await buildApp(); token = makeToken(); });
  afterAll(() => app.close());

  it('returns 200 ok true when card deleted', async () => {
    mockSrsCardModel.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/cards/${CARD_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('returns 404 when card not found', async () => {
    mockSrsCardModel.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/college/${COLLEGE_ID}/student/srs/cards/ghost-card`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
