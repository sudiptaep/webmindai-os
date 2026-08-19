/**
 * F-20-B (part 2): mines newly-observed misconceptions from students' actual
 * wrong answers. Runs nightly per department; can also be triggered on
 * demand via misconceptionRouter.mine.
 *
 * There is no concept_id on quiz questions or SRS cards (F-13-D / F-14-A
 * predate the concept graph), so wrong answers are grouped by (doc_id,
 * chapter_index) — the finest grain available — and an LLM pass maps each
 * cluster to the specific concept in that chapter it reflects a
 * misunderstanding of. This is a pragmatic substitute for embedding-based
 * clustering: the codebase already leans on Claude's judgment for this kind
 * of open-ended grouping task elsewhere (see rag.service.ts, quiz.service.ts).
 */
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Connection } from "mongoose";
import { LLM_MODEL_CHAT } from "@college-chatbot/shared";
import { getCollegeModel } from "../models/platform/college.model";
import { getCollegeDb } from "../db/college.db";
import { getDepartmentModel } from "../models/college/department.model";
import { getDocumentModel } from "../models/college/document.model";
import { getConceptModel } from "../models/college/concept-graph.model";
import { getMisconceptionModel } from "../models/college/misconception.model";
import { getQuizSessionModel } from "../models/college/quiz-session.model";
import { getSrsReviewLogModel } from "../models/college/srs-review-log.model";
import { getSrsCardModel } from "../models/college/srs-card.model";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "../services/metering.service";

const MINING_MODEL         = process.env.MISCONCEPTION_MINING_MODEL ?? LLM_MODEL_CHAT;
const MIN_ERRORS_TO_MINE   = Number(process.env.MISCONCEPTION_MIN_ERRORS_TO_MINE ?? 8);
const MIN_CLUSTER_SIZE     = Number(process.env.MISCONCEPTION_MIN_CLUSTER_SIZE ?? 4);
const LOOKBACK_DAYS        = Number(process.env.MISCONCEPTION_MINING_LOOKBACK_DAYS ?? 30);

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

interface WrongAnswer {
  question_text: string;
  correct_answer: string;
  student_answer: string;
}

async function gatherWrongAnswers(conn: Connection, docId: string, chapterIndex: number, since: Date): Promise<WrongAnswer[]> {
  const QuizSession = getQuizSessionModel(conn);
  const sessions = await QuizSession.find({
    doc_id: docId,
    chapter_index: chapterIndex,
    completed_at: { $gte: since },
  }).select("questions").lean();

  const fromQuizzes: WrongAnswer[] = sessions.flatMap((s) =>
    (s.questions ?? [])
      .filter((q) => q.is_correct === false && q.student_answer)
      .map((q) => ({
        question_text: q.question_text,
        correct_answer: q.correct_answer,
        student_answer: q.student_answer!,
      })),
  );

  // SRS cards don't carry concept_id but do carry chapter_index directly
  const SrsCard = getSrsCardModel(conn);
  const SrsReviewLog = getSrsReviewLogModel(conn);
  const cards = await SrsCard.find({ doc_id: docId, chapter_index: chapterIndex }).select("_id question_text correct_answer").lean();
  const cardById = new Map(cards.map((c) => [c._id, c]));

  const logs = await SrsReviewLog.find({
    srs_card_id: { $in: [...cardById.keys()] },
    was_correct: false,
    reviewed_at: { $gte: since },
  }).select("srs_card_id student_answer").lean();

  const fromSrs: WrongAnswer[] = logs
    .map((log) => {
      const card = cardById.get(log.srs_card_id);
      if (!card) return null;
      return { question_text: card.question_text, correct_answer: card.correct_answer, student_answer: log.student_answer };
    })
    .filter((x): x is WrongAnswer => x !== null);

  return [...fromQuizzes, ...fromSrs];
}

const MINING_SYSTEM_PROMPT = `You cluster students' wrong answers into distinct misconceptions and
map each cluster to the specific concept it reflects a misunderstanding of. Respond ONLY with a
valid JSON array, no markdown. Each element:
{
  "concept_name": "must exactly match one of the provided concept names",
  "statement": "the wrong belief, phrased as a student would hold it",
  "correct_model": "the accurate model, stated plainly",
  "root_cause": "the underlying reasoning error",
  "diagnostic_probe": "a question whose answer distinguishes the wrong model from the right one",
  "probe_correct_answer": "what a student holding the correct model would say",
  "probe_wrong_answer": "what a student holding the misconception would say",
  "member_count": 5
}
Only return clusters with at least ${MIN_CLUSTER_SIZE} supporting wrong answers (member_count).
If nothing clusters meaningfully, return an empty array.`;

async function mineChapter(conn: Connection, collegeId: string, deptId: string, docId: string, chapterIndex: number, since: Date): Promise<void> {
  const wrongAnswers = await gatherWrongAnswers(conn, docId, chapterIndex, since);
  if (wrongAnswers.length < MIN_ERRORS_TO_MINE) return;

  const Concept = getConceptModel(conn);
  const concepts = await Concept.find({ doc_id: docId, chapter_index: chapterIndex }).lean();
  if (concepts.length === 0) return;

  const userPrompt = `Concepts in this chapter:
${concepts.map((c) => `- ${c.canonical_name}: ${c.one_line_definition}`).join("\n")}

Wrong answers observed (question / correct answer / what the student said):
${wrongAnswers.slice(0, 80).map((w, i) => `${i + 1}. Q: ${w.question_text}\n   Correct: ${w.correct_answer}\n   Student said: ${w.student_answer}`).join("\n")}`;

  let clusters: Array<Record<string, unknown>>;
  try {
    const response = await getClient().messages.create({
      model: MINING_MODEL,
      max_tokens: 2048,
      system: MINING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rate = await getRateTable("anthropic", MINING_MODEL);
    const costUsd =
      (response.usage.input_tokens / 1000) * rate.input_token_cost_per_1k +
      (response.usage.output_tokens / 1000) * rate.output_token_cost_per_1k;
    recordCostEvent({
      college_id: collegeId,
      dept_id: deptId,
      action_type: "misconception_mining",
      service: "anthropic",
      model: MINING_MODEL,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      cost_usd: costUsd,
      billing_month: getBillingMonth(),
      billing_day: getBillingDay(),
      created_at: new Date(),
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text : "";
    clusters = JSON.parse(stripFences(rawText));
    if (!Array.isArray(clusters)) return;
  } catch (err) {
    console.error(`[mineMisconceptions] doc ${docId} ch ${chapterIndex} LLM pass failed:`, err);
    return;
  }

  const Misconception = getMisconceptionModel(conn);
  const conceptByName = new Map(concepts.map((c) => [c.canonical_name.toLowerCase(), c]));

  // Fetch every existing misconception for these concepts once, up front —
  // matching against a single arbitrary findOne() per cluster (the previous
  // approach) missed real matches whenever a concept already had 2+
  // misconceptions on file (the normal case after seeding), silently
  // creating duplicates instead of reinforcing the right one.
  const existingByConcept = new Map<string, Array<{ _id: string; statement: string; source: string }>>();
  const existingRows = await Misconception.find({ concept_id: { $in: concepts.map((c) => c._id) } })
    .select("concept_id statement source")
    .lean();
  for (const row of existingRows) {
    const list = existingByConcept.get(row.concept_id) ?? [];
    list.push(row);
    existingByConcept.set(row.concept_id, list);
  }

  for (const cluster of clusters) {
    const memberCount = Number(cluster.member_count ?? 0);
    if (memberCount < MIN_CLUSTER_SIZE) continue;
    const concept = conceptByName.get(String(cluster.concept_name ?? "").toLowerCase());
    if (!concept || !cluster.statement || !cluster.diagnostic_probe) continue;

    // Match against every existing misconception for this concept by rough
    // statement similarity (case-insensitive substring either direction) —
    // cheap and good enough given clusters are already LLM-deduplicated per run.
    const statementLower = String(cluster.statement).toLowerCase();
    const candidates = existingByConcept.get(concept._id) ?? [];
    const existing = candidates.find((c) =>
      c.statement.toLowerCase().includes(statementLower.slice(0, 30)) ||
      statementLower.includes(c.statement.toLowerCase().slice(0, 30)),
    );

    if (existing) {
      await Misconception.updateOne(
        { _id: existing._id },
        {
          $inc: { observed_count: memberCount },
          $set: {
            last_observed: new Date(),
            source: existing.source === "llm_seeded" ? "seeded_and_observed" : existing.source,
          },
        },
      );
    } else {
      const now = new Date();
      const newId = randomUUID();
      await Misconception.create({
        _id: newId,
        concept_id: concept._id,
        college_id: collegeId,
        dept_id: deptId,
        statement: String(cluster.statement),
        correct_model: String(cluster.correct_model ?? ""),
        root_cause: String(cluster.root_cause ?? ""),
        diagnostic_probe: String(cluster.diagnostic_probe),
        probe_correct_answer: String(cluster.probe_correct_answer ?? ""),
        probe_wrong_answer: String(cluster.probe_wrong_answer ?? ""),
        source: "observed_from_students",
        observed_count: memberCount,
        first_observed: now,
        last_observed: now,
        times_probed: 0,
        times_corrected: 0,
        correction_success_rate: null,
        reviewed_by_faculty: false,
        priority_rank: 0,
      });
      // Track it so a later cluster in this same run (same concept) can
      // match against it instead of creating a second duplicate.
      const list = existingByConcept.get(concept._id) ?? [];
      list.push({ _id: newId, statement: String(cluster.statement), source: "observed_from_students" });
      existingByConcept.set(concept._id, list);
    }
  }
}

async function recomputeCorrectionSuccessRates(conn: Connection): Promise<void> {
  const Misconception = getMisconceptionModel(conn);
  const all = await Misconception.find({ times_probed: { $gt: 0 } }).select("_id times_probed times_corrected").lean();
  const bulkOps = all.map((m) => ({
    updateOne: {
      filter: { _id: m._id },
      update: { $set: { correction_success_rate: m.times_corrected / m.times_probed } },
    },
  }));
  if (bulkOps.length > 0) await Misconception.bulkWrite(bulkOps, { ordered: false });
}

export async function runMisconceptionMining(collegeId: string, deptId?: string): Promise<void> {
  const conn = await getCollegeDb(collegeId);
  const Department = getDepartmentModel(conn);
  const Document = getDocumentModel(conn);
  const Concept = getConceptModel(conn);

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  const depts = deptId
    ? [{ _id: deptId }]
    : await Department.find({ deleted: { $ne: true } }).select("_id").lean();

  for (const dept of depts) {
    const docs = await Document.find({ dept_id: dept._id, concept_graph_extracted: true }).select("_id").lean();
    for (const doc of docs) {
      const chapterIndices: number[] = await Concept.distinct("chapter_index", { doc_id: doc._id });
      for (const chapterIndex of chapterIndices) {
        try {
          await mineChapter(conn, collegeId, String(dept._id), String(doc._id), chapterIndex, since);
        } catch (err) {
          console.error(`[mineMisconceptions] college ${collegeId} doc ${doc._id} ch ${chapterIndex} failed:`, err);
        }
      }
    }
  }

  await recomputeCorrectionSuccessRates(conn);
}

/** Nightly entry point — mines every active college's departments. */
export async function runMisconceptionMiningAllColleges(): Promise<void> {
  const College = getCollegeModel();
  const colleges = await College.find({ status: "active" }).select("_id").lean();
  for (const college of colleges) {
    try {
      await runMisconceptionMining(String(college._id));
    } catch (err) {
      console.error(`[mineMisconceptions] college ${college._id} failed:`, err);
    }
  }
}
