import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Connection } from "mongoose";
import type { ClinicalCase, CaseQuestionType, CaseDifficulty } from "@college-chatbot/shared";
import { LLM_MODEL_EXAM } from "@college-chatbot/shared";
import { getClinicalCaseModel } from "../models/college/clinical-case.model";
import { getDocumentModel } from "../models/college/document.model";
import { fetchDocChunks } from "./pinecone.service";

const CASE_MODEL        = process.env.CASE_GENERATION_MODEL ?? LLM_MODEL_EXAM;
const CASE_MAX_TOKENS   = Number(process.env.CASE_MAX_TOKENS ?? 2048);
const CACHE_TTL_DAYS    = Number(process.env.CASE_CACHE_TTL_DAYS ?? 7);
const CACHE_MAX_SERVES  = Number(process.env.CASE_CACHE_MAX_SERVES ?? 10);
const CASE_MAX_CONTEXT  = 40_000;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface GenerateCaseParams {
  docId: string;
  chapterIndex: number;
  questionType: CaseQuestionType;
  difficulty: CaseDifficulty;
  collegeId: string;
  deptId: string;
  conn: Connection;
}

export interface CaseForStudent {
  case_id: string;
  case_text: string;
  question: string;
  question_type: CaseQuestionType;
  difficulty: CaseDifficulty;
  options: string[];
  correct_answer: string;
  expected_answer: string;
  key_teaching_points: string[];
  source_pages: number[];
  doc_id: string;
  chapter_index: number;
  from_cache: boolean;
}

// ─── Prompt templates ─────────────────────────────────────────────────────────

const CASE_TYPE_PROMPTS: Record<CaseQuestionType, string> = {
  diagnosis: `Create a case where the student must identify the most likely diagnosis.
Include 2–3 classic features that point to the diagnosis from the textbook content.
Include 1–2 "distractors" (conditions that might seem similar but can be excluded).`,

  management: `Create a case where the patient has already been diagnosed.
The question should focus on immediate management or next best step.
Include relevant vitals/labs that guide the management decision.`,

  investigation: `Create a case where the student must choose the most appropriate investigation.
Include clinical context that makes the investigation choice non-obvious.`,

  mechanism: `Create a case that requires understanding the pathophysiological mechanism.
The question should start with a clinical presentation and ask WHY it occurs.`,

  complication: `Create a case where a patient on treatment develops a new finding.
The student must identify the complication and connect it to the mechanism.`,
};

const DIFFICULTY_PROMPTS: Record<CaseDifficulty, string> = {
  recall:      "Use classic, textbook-perfect presentations. Avoid unusual features.",
  application: "Use slightly atypical presentations requiring application of principles.",
  analysis:    "Include multiple possible diagnoses, subtle clues, and require reasoning through differentials.",
};

const SYSTEM_PROMPT = `You are a medical case writer creating exam questions for MBBS students.
Generate cases STRICTLY from the provided textbook content — every clinical feature, lab value, and management step must be defensible from the source material.
Respond ONLY with a valid JSON object. No markdown, no preamble, no explanation outside the JSON.
Required schema:
{
  "case_text": "Detailed patient presentation (3–5 sentences)",
  "question": "Single clear question",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correct_answer": "A",
  "expected_answer": "Full explanation with source citation",
  "key_teaching_points": ["point 1", "point 2", "point 3"],
  "source_pages": [214, 215],
  "bloom_level": "apply"
}`;

// ─── JSON parse (same pattern as quiz.service.ts) ─────────────────────────────

function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseCaseJson(raw: string, questionType: CaseQuestionType, difficulty: CaseDifficulty) {
  const parsed = JSON.parse(stripJsonFences(raw));
  return {
    case_text:           String(parsed.case_text ?? ""),
    question:            String(parsed.question ?? ""),
    options:             Array.isArray(parsed.options) ? (parsed.options as string[]) : [],
    correct_answer:      String(parsed.correct_answer ?? ""),
    expected_answer:     String(parsed.expected_answer ?? ""),
    key_teaching_points: Array.isArray(parsed.key_teaching_points)
      ? (parsed.key_teaching_points as string[])
      : [],
    source_pages: Array.isArray(parsed.source_pages)
      ? (parsed.source_pages as number[])
      : [],
    bloom_level:  String(parsed.bloom_level ?? "apply"),
    question_type: questionType,
    difficulty,
  };
}

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateClinicalCase(
  params: GenerateCaseParams,
): Promise<CaseForStudent> {
  const { docId, chapterIndex, questionType, difficulty, collegeId, deptId, conn } = params;

  const ClinicalCase = getClinicalCaseModel(conn);

  // 1. Cache check — serve if not exhausted and not expired
  const now = new Date();
  const cached = await ClinicalCase.findOne({
    doc_id:        docId,
    chapter_index: chapterIndex,
    question_type: questionType,
    difficulty,
    times_served:  { $lt: CACHE_MAX_SERVES },
    $or: [
      { expires_at: { $exists: false } },
      { expires_at: { $gt: now } },
    ],
  }).lean();

  if (cached) {
    await ClinicalCase.updateOne({ _id: cached._id }, { $inc: { times_served: 1 } });
    return formatCaseForStudent(cached, true);
  }

  // 2. Get document metadata
  const Document = getDocumentModel(conn);
  const doc = await Document.findById(docId).select("original_filename subject_id").lean();
  if (!doc) throw new Error(`Document ${docId} not found`);
  const filename  = doc.original_filename ?? docId;
  const subjectId = doc.subject_id ?? "";

  // 3. Fetch chunks from entire document (not limited to a single chapter)
  const chunks = await fetchDocChunks(collegeId, deptId, docId, 30);
  if (chunks.length === 0) throw new Error("No content indexed for this document");

  const contextText = chunks
    .map(c => `[Page ${c.page_num}] ${c.text}`)
    .join("\n\n")
    .slice(0, CASE_MAX_CONTEXT);

  // 4. Build and send prompt
  const userPrompt = `${CASE_TYPE_PROMPTS[questionType]}
${DIFFICULTY_PROMPTS[difficulty]}
Document: ${filename}

Textbook content:
${contextText}`;

  const response = await getClient().messages.create({
    model:      CASE_MODEL,
    max_tokens: CASE_MAX_TOKENS,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: userPrompt }],
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "";

  let parsed;
  try {
    parsed = parseCaseJson(rawText, questionType, difficulty);
  } catch (e) {
    throw new Error(`Case JSON parse failed: ${(e as Error).message}`);
  }

  // 6. Store in cache
  const expiresAt = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 3600 * 1000);
  const caseRecord: Omit<ClinicalCase, "created_at"> = {
    _id:          randomUUID(),
    college_id:   collegeId,
    dept_id:      deptId,
    doc_id:       docId,
    chapter_index: chapterIndex,
    subject_id:   subjectId,
    ...parsed,
    generated_from_chunk_ids: chunks.map(c => `${docId}_${c.chunk_index}`),
    cache_version:  1,
    times_served:   1,
    expires_at:     expiresAt,
  };

  await ClinicalCase.create(caseRecord);

  return formatCaseForStudent(caseRecord as ClinicalCase, false);
}

// ─── List cached cases for a chapter ─────────────────────────────────────────

export async function listChapterCases(
  docId: string,
  chapterIndex: number,
  conn: Connection,
): Promise<{ cases: CaseForStudent[]; total: number }> {
  const ClinicalCase = getClinicalCaseModel(conn);
  const now = new Date();

  const cases = await ClinicalCase.find({
    doc_id:        docId,
    chapter_index: chapterIndex,
    $or: [
      { expires_at: { $exists: false } },
      { expires_at: { $gt: now } },
    ],
  })
    .sort({ created_at: -1 })
    .lean();

  return {
    cases: cases.map(c => formatCaseForStudent(c, true)),
    total: cases.length,
  };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatCaseForStudent(c: ClinicalCase, fromCache: boolean): CaseForStudent {
  return {
    case_id:             c._id,
    case_text:           c.case_text,
    question:            c.question,
    question_type:       c.question_type,
    difficulty:          c.difficulty,
    options:             c.options,
    correct_answer:      c.correct_answer,
    expected_answer:     c.expected_answer,
    key_teaching_points: c.key_teaching_points,
    source_pages:        c.source_pages,
    doc_id:              c.doc_id,
    chapter_index:       c.chapter_index,
    from_cache:          fromCache,
  };
}
