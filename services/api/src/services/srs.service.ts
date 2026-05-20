import { randomUUID } from "crypto";
import type { Connection } from "mongoose";
import type { SrsCard } from "@college-chatbot/shared";
import { getSrsCardModel } from "../models/college/srs-card.model";
import { getSrsReviewLogModel } from "../models/college/srs-review-log.model";
import { getStudentModel } from "../models/college/student.model";
import { getQuizSessionModel } from "../models/college/quiz-session.model";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SM2Result {
  interval_days: number;
  ease_factor: number;
  repetition_count: number;
  next_review_at: Date;
}

export interface ReviewCardParams {
  cardId: string;
  quality: number;        // 0–5
  studentAnswer: string;
  timeTakenSeconds: number;
  studentId: string;
  collegeId: string;
}

export interface AddManualCardParams {
  studentId: string;
  collegeId: string;
  deptId: string;
  docId: string;
  chapterIndex: number;
  subjectId: string;
  questionText: string;
  questionType: string;
  correctAnswer: string;
  explanation: string;
  sourcePage?: number;
  bloomLevel?: string;
}

// ─── SM-2 algorithm ───────────────────────────────────────────────────────────

export function calculateNextInterval(
  card: Pick<SrsCard, "ease_factor" | "interval_days" | "repetition_count">,
  quality: number,
): SM2Result {
  let { ease_factor, interval_days, repetition_count } = card;

  if (quality < 3) {
    // Failed — reset to beginning
    repetition_count = 0;
    interval_days = 1;
  } else {
    // Passed — advance interval
    if (repetition_count === 0) {
      interval_days = 1;
    } else if (repetition_count === 1) {
      interval_days = 3;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    repetition_count += 1;
  }

  // Clamp ease_factor between 1.3 and 3.0
  ease_factor = Math.max(
    1.3,
    Math.min(3.0, ease_factor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  const next_review_at = new Date();
  next_review_at.setDate(next_review_at.getDate() + interval_days);

  return { interval_days, ease_factor, repetition_count, next_review_at };
}

// ─── Card creation ────────────────────────────────────────────────────────────

/**
 * Called fire-and-forget after quiz session completion.
 * Adds correctly-answered questions (bloom > "remember") to the student's SRS deck.
 */
export async function addCorrectAnswersToSRS(
  sessionId: string,
  studentId: string,
  collegeId: string,
  conn: Connection,
): Promise<void> {
  try {
    const QuizSession = getQuizSessionModel(conn);
    const SrsCard = getSrsCardModel(conn);

    const session = await QuizSession.findById(sessionId).lean();
    if (!session) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const correctQuestions = session.questions.filter(
      q => q.is_correct === true && q.bloom_level !== "remember",
    );
    if (correctQuestions.length === 0) return;

    // Bulk dedupe: fetch existing question_texts for this student in this chapter
    const existingTexts = new Set(
      (
        await SrsCard.find(
          { student_id: studentId, doc_id: session.doc_id, chapter_index: session.chapter_index },
          { question_text: 1 },
        ).lean()
      ).map(c => c.question_text),
    );

    const now = new Date();
    const toInsert = correctQuestions
      .filter(q => !existingTexts.has(q.question_text))
      .map(q => ({
        _id:               randomUUID(),
        student_id:        studentId,
        college_id:        collegeId,
        dept_id:           session.dept_id,
        doc_id:            session.doc_id,
        chapter_index:     session.chapter_index ?? 0,
        subject_id:        session.subject_id,
        question_text:     q.question_text,
        question_type:     q.question_type,
        options:           q.options ?? [],
        correct_answer:    q.correct_answer,
        explanation:       q.explanation ?? "",
        source_page:       q.source_page,
        bloom_level:       q.bloom_level ?? "understand",
        ease_factor:       2.5,
        interval_days:     1,
        repetition_count:  0,
        last_quality:      5,
        next_review_at:    tomorrow,
        first_seen_at:     now,
        last_reviewed_at:  now,
        status:            "active" as const,
      }));

    if (toInsert.length === 0) return;

    await SrsCard.insertMany(toInsert, { ordered: false });

    // Update student's srs_total_cards count
    const Student = getStudentModel(conn);
    await Student.updateOne(
      { _id: studentId },
      { $inc: { srs_total_cards: toInsert.length } },
    );
  } catch (err) {
    // Non-fatal — log but don't surface to caller
    console.error("[srs] addCorrectAnswersToSRS failed:", err);
  }
}

export async function addManualCard(
  params: AddManualCardParams,
  conn: Connection,
): Promise<{ srs_card_id: string; next_review_at: Date }> {
  const SrsCard = getSrsCardModel(conn);

  // Dedupe by question_text for this student
  const existing = await SrsCard.findOne({
    student_id: params.studentId,
    question_text: params.questionText,
  }).lean();
  if (existing) return { srs_card_id: existing._id, next_review_at: existing.next_review_at };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const now = new Date();
  const card = await SrsCard.create({
    _id:              randomUUID(),
    student_id:       params.studentId,
    college_id:       params.collegeId,
    dept_id:          params.deptId,
    doc_id:           params.docId,
    chapter_index:    params.chapterIndex,
    subject_id:       params.subjectId,
    question_text:    params.questionText,
    question_type:    params.questionType,
    options:          [],
    correct_answer:   params.correctAnswer,
    explanation:      params.explanation,
    source_page:      params.sourcePage,
    bloom_level:      params.bloomLevel ?? "understand",
    ease_factor:      2.5,
    interval_days:    1,
    repetition_count: 0,
    last_quality:     5,
    next_review_at:   tomorrow,
    first_seen_at:    now,
    last_reviewed_at: now,
    status:           "active",
  });

  const Student = getStudentModel(conn);
  await Student.updateOne({ _id: params.studentId }, { $inc: { srs_total_cards: 1 } });

  return { srs_card_id: card._id, next_review_at: tomorrow };
}

// ─── Review session ───────────────────────────────────────────────────────────

export async function getDueTodayCards(
  studentId: string,
  collegeId: string,
  conn: Connection,
): Promise<{ cards: SrsCard[]; total_due: number; total_active: number; streak: number }> {
  const SrsCard = getSrsCardModel(conn);
  const Student = getStudentModel(conn);

  const student = await Student.findById(studentId).lean();
  const dailyTarget = student?.daily_srs_target ?? 20;

  const now = new Date();

  const [cards, total_due, total_active] = await Promise.all([
    SrsCard.find({ student_id: studentId, status: "active", next_review_at: { $lte: now } })
      .sort({ next_review_at: 1 })
      .limit(dailyTarget)
      .lean(),
    SrsCard.countDocuments({ student_id: studentId, status: "active", next_review_at: { $lte: now } }),
    SrsCard.countDocuments({ student_id: studentId, status: "active" }),
  ]);

  // Shuffle to prevent order memorisation
  const shuffled = [...cards].sort(() => Math.random() - 0.5);

  return {
    cards: shuffled as SrsCard[],
    total_due,
    total_active,
    streak: student?.srs_streak_days ?? 0,
  };
}

export async function reviewCard(
  params: ReviewCardParams,
  conn: Connection,
): Promise<{ interval_days: number; next_review_at: Date; ease_factor: number; streak: number }> {
  const SrsCard = getSrsCardModel(conn);
  const SrsReviewLog = getSrsReviewLogModel(conn);

  const card = await SrsCard.findOne({ _id: params.cardId, student_id: params.studentId }).lean();
  if (!card) throw new Error("SRS card not found");

  const { interval_days, ease_factor, repetition_count, next_review_at } =
    calculateNextInterval(card, params.quality);

  const wasCorrect = params.quality >= 3;
  const now = new Date();

  await Promise.all([
    // Update the card
    SrsCard.updateOne(
      { _id: params.cardId },
      {
        $set: {
          ease_factor,
          interval_days,
          repetition_count,
          last_quality:      params.quality,
          next_review_at,
          last_reviewed_at:  now,
          // Graduate if interval exceeds threshold
          status: interval_days >= Number(process.env.SRS_GRADUATION_INTERVAL_DAYS ?? 180)
            ? "graduated"
            : "active",
          updated_at: now,
        },
      },
    ),
    // Append review log
    SrsReviewLog.create({
      _id:                randomUUID(),
      srs_card_id:        params.cardId,
      student_id:         params.studentId,
      college_id:         params.collegeId,
      quality:            params.quality,
      student_answer:     params.studentAnswer,
      was_correct:        wasCorrect,
      time_taken_seconds: params.timeTakenSeconds,
      interval_before:    card.interval_days,
      ease_before:        card.ease_factor,
      interval_after:     interval_days,
      ease_after:         ease_factor,
      next_review_at,
      reviewed_at:        now,
    }),
  ]);

  // Update streak (non-fatal)
  const streak = await updateSRSStreak(params.studentId, params.collegeId, conn);

  return { interval_days, next_review_at, ease_factor, streak };
}

// ─── Streak ───────────────────────────────────────────────────────────────────

export async function updateSRSStreak(
  studentId: string,
  collegeId: string,
  conn: Connection,
): Promise<number> {
  try {
    const Student = getStudentModel(conn);
    const student = await Student.findById(studentId).lean();
    if (!student) return 0;

    const today = getTodayString();
    const yesterday = getYesterdayString();

    if (student.srs_last_review_date === today) return student.srs_streak_days ?? 0;

    const newStreak =
      student.srs_last_review_date === yesterday
        ? (student.srs_streak_days ?? 0) + 1
        : 1;

    await Student.updateOne(
      { _id: studentId },
      { $set: { srs_streak_days: newStreak, srs_last_review_date: today } },
    );

    return newStreak;
  } catch {
    return 0;
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getSRSStats(
  studentId: string,
  conn: Connection,
): Promise<{
  total_cards: number;
  active_cards: number;
  graduated_cards: number;
  due_today: number;
  streak: number;
  avg_ease_factor: number;
  retention_rate_pct: number;
}> {
  const SrsCard = getSrsCardModel(conn);
  const SrsReviewLog = getSrsReviewLogModel(conn);
  const Student = getStudentModel(conn);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const [student, active, graduated, dueToday, easeAgg, recentLogs] = await Promise.all([
    Student.findById(studentId).lean(),
    SrsCard.countDocuments({ student_id: studentId, status: "active" }),
    SrsCard.countDocuments({ student_id: studentId, status: "graduated" }),
    SrsCard.countDocuments({ student_id: studentId, status: "active", next_review_at: { $lte: now } }),
    SrsCard.aggregate([
      { $match: { student_id: studentId, status: "active" } },
      { $group: { _id: null, avg: { $avg: "$ease_factor" } } },
    ]),
    SrsReviewLog.find(
      { student_id: studentId, reviewed_at: { $gte: thirtyDaysAgo } },
      { was_correct: 1 },
    ).lean(),
  ]);

  const avgEase = (easeAgg[0]?.avg as number | undefined) ?? 2.5;
  const retentionPct =
    recentLogs.length > 0
      ? Math.round((recentLogs.filter(l => l.was_correct).length / recentLogs.length) * 100)
      : 0;

  return {
    total_cards:        (active + graduated),
    active_cards:       active,
    graduated_cards:    graduated,
    due_today:          dueToday,
    streak:             student?.srs_streak_days ?? 0,
    avg_ease_factor:    Math.round(avgEase * 100) / 100,
    retention_rate_pct: retentionPct,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getYesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
