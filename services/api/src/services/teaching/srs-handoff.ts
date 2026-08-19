import { randomUUID } from "crypto";
import type { Connection } from "mongoose";
import type { CheckHistoryEntry, TeachingSession } from "@college-chatbot/shared";
import { getSrsCardModel } from "../../models/college/srs-card.model";
import { getMisconceptionModel } from "../../models/college/misconception.model";
import { getStudentModel } from "../../models/college/student.model";
import type { SessionContext } from "./types";

/**
 * F-20-C §10.4 — seeds SRS cards from the checks the student found hardest in
 * a just-completed teaching session, plus one card for the misconception
 * that was corrected (if any). Deliberately targeted at what THIS session
 * revealed was shaky, not generic chapter content.
 */
export async function createSRSCardsFromSession(
  conn: Connection,
  session: Pick<TeachingSession, "_id" | "student_id" | "college_id" | "dept_id" | "doc_id" | "subject_id" | "check_history" | "misconception_addressed_id">,
  ctx: SessionContext,
): Promise<string[]> {
  // Read fresh per call rather than frozen at module load — cheap, and lets
  // tests/ops toggle behavior without a process restart.
  const handoffEnabled = (process.env.TEACHING_SRS_HANDOFF_ENABLED ?? "true").toLowerCase() !== "false";
  const cardsPerSession = Number(process.env.TEACHING_SRS_CARDS_PER_SESSION ?? 3);
  if (!handoffEnabled) return [];

  const hardestChecks = [...session.check_history]
    .filter((c: CheckHistoryEntry) => !c.passed || c.confidence < 0.7)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, cardsPerSession);

  if (hardestChecks.length === 0 && !session.misconception_addressed_id) return [];

  const sourcePage = ctx.concept.source_pages[0];
  const citation = `${ctx.concept.canonical_name} — Page ${sourcePage ?? "?"}`;

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const cards: Array<Record<string, unknown> & { _id: string; question_text: string; origin: "teaching_session" | "teaching_session_misconception" }> = hardestChecks.map((check) => ({
    _id: randomUUID(),
    student_id: session.student_id,
    college_id: session.college_id,
    dept_id: session.dept_id,
    doc_id: session.doc_id,
    chapter_index: ctx.concept.chapter_index,
    subject_id: session.subject_id ?? "",
    question_text: check.question,
    question_type: "SAQ" as const,
    options: [],
    correct_answer: check.expected_answer,
    explanation: `${check.expected_answer}\n\n— ${citation}`,
    source_page: sourcePage,
    bloom_level: ctx.concept.bloom_ceiling,
    ease_factor: 2.5,
    interval_days: 1,
    repetition_count: 0,
    last_quality: 5,
    next_review_at: tomorrow,
    first_seen_at: now,
    last_reviewed_at: now,
    status: "active" as const,
    origin: "teaching_session" as const,
    origin_session_id: session._id,
  }));

  // Always add one card for the misconception that was corrected this session.
  if (session.misconception_addressed_id) {
    const Misconception = getMisconceptionModel(conn);
    const m = await Misconception.findById(session.misconception_addressed_id).lean();
    if (m) {
      cards.push({
        _id: randomUUID(),
        student_id: session.student_id,
        college_id: session.college_id,
        dept_id: session.dept_id,
        doc_id: session.doc_id,
        chapter_index: ctx.concept.chapter_index,
        subject_id: session.subject_id ?? "",
        question_text: m.diagnostic_probe,
        question_type: "SAQ" as const,
        options: [],
        correct_answer: m.probe_correct_answer,
        explanation: `Correct model: ${m.correct_model}\n\nCommon error: ${m.statement}`,
        source_page: sourcePage,
        bloom_level: "understand",
        ease_factor: 2.5,
        interval_days: 1,
        repetition_count: 0,
        last_quality: 5,
        next_review_at: tomorrow,
        first_seen_at: now,
        last_reviewed_at: now,
        status: "active" as const,
        origin: "teaching_session_misconception" as const,
        origin_session_id: session._id,
      });
    }
  }

  if (cards.length === 0) return [];

  const SrsCard = getSrsCardModel(conn);
  // Dedupe against cards this student already has for this chapter — a
  // teaching session on a concept the student has drilled before shouldn't
  // spam duplicate cards into their deck.
  const existingTexts = new Set(
    (await SrsCard.find(
      { student_id: session.student_id, doc_id: session.doc_id, chapter_index: ctx.concept.chapter_index },
      { question_text: 1 },
    ).lean()).map((c) => c.question_text),
  );
  const toInsert = cards.filter((c) => !existingTexts.has(c.question_text));
  if (toInsert.length === 0) return [];

  await SrsCard.insertMany(toInsert, { ordered: false });

  const Student = getStudentModel(conn);
  await Student.updateOne({ _id: session.student_id }, { $inc: { srs_total_cards: toInsert.length } });

  return toInsert.map((c) => c._id);
}
