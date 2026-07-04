import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { LLM_MODEL_EXAM } from "@college-chatbot/shared";
import type { Connection } from "mongoose";
import { fetchChapterChunks } from "./pinecone.service";
import { getQuizSessionModel } from "../models/college/quiz-session.model";
import { getChapterMapModel } from "../models/college/chapter-map.model";
import { getPYQQuestionModel } from "../models/college/pyq-question.model";
import { getImageAssetModel } from "../models/college/image-asset.model";
import type { QuizSession, QuizQuestion, QuizMode, QuizQuestionType, QuizDifficulty, ImageAsset } from "@college-chatbot/shared";

const QUIZ_MAX_CONTEXT = 60_000;
const QUIZ_GENERATION_MODEL = process.env.QUIZ_GENERATION_MODEL ?? LLM_MODEL_EXAM;
const QUIZ_MAX_TOKENS = Number(process.env.QUIZ_MAX_TOKENS ?? 4096);

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface GenerateQuizParams {
  collegeId: string;
  deptId: string;
  docId: string;
  chapterIndex: number;
  studentId: string;
  subjectId: string;
  questionType: QuizQuestionType;
  difficulty: QuizDifficulty;
  count: number;
  includePyq: boolean;
  timed: boolean;
  timeLimitPerQuestion?: number;
  conn: Connection;
}

export interface QuizGenerateResult {
  quiz_session_id: string;
  questions: QuizQuestion[];
  total_count: number;
  time_limit_seconds: number | null;
}

// ─── Question generation ──────────────────────────────────────────────────────

function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseQuizJson(raw: string): QuizQuestion[] {
  try {
    const arr = JSON.parse(stripJsonFences(raw));
    if (!Array.isArray(arr)) throw new Error("Response is not an array");
    return arr.map((q: Record<string, unknown>, i: number) => ({
      question_id:    randomUUID(),
      question_text:  String(q.question_text ?? ""),
      question_type:  String(q.question_type ?? "MCQ") as QuizQuestionType,
      options:        Array.isArray(q.options) ? (q.options as string[]) : [],
      correct_answer: String(q.correct_answer ?? ""),
      explanation:    String(q.explanation ?? ""),
      source_page:    typeof q.source_page === "number" ? q.source_page : undefined,
      bloom_level:    String(q.bloom_level ?? "remember"),
      difficulty:     String(q.difficulty ?? "recall") as QuizDifficulty,
      is_pyq:         false,
      student_answer: undefined,
      is_correct:     undefined,
    }));
  } catch (e) {
    throw new Error(`Quiz JSON parse failed: ${(e as Error).message}`);
  }
}

// ─── F-17-G: Image-label questions ─────────────────────────────────────────────

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function generateImageLabelQuestions(
  collegeId: string,
  docId: string,
  startPage: number,
  endPage: number,
  count: number,
  conn: Connection,
): Promise<QuizQuestion[]> {
  const ImageAssetModel = getImageAssetModel(conn);
  const candidates = await ImageAssetModel.find({
    doc_id: docId,
    was_filtered: false,
    vision_status: "completed",
    hidden: { $ne: true },
    source_page: { $gte: startPage, $lte: endPage },
  }).lean<ImageAsset[]>();

  const eligible = candidates.filter((img) => (img.labels_extracted ?? []).length >= 3);
  if (eligible.length === 0) return [];

  const chosen = pickRandom(eligible, Math.min(count, eligible.length));

  return chosen.map((asset) => {
    const targetLabel = asset.labels_extracted[Math.floor(Math.random() * asset.labels_extracted.length)];
    const options = pickRandom(asset.labels_extracted.filter((l) => l !== targetLabel), 3);
    options.push(targetLabel);

    return {
      question_id: randomUUID(),
      question_text: "In the diagram shown, what structure is indicated by the highlighted label?",
      question_type: "IMAGE_LABEL" as QuizQuestionType,
      options: pickRandom(options, options.length),
      correct_answer: targetLabel,
      explanation: `This is the ${targetLabel}. ${(asset.description ?? "").slice(0, 200)}`,
      source_page: asset.source_page,
      bloom_level: "remember",
      difficulty: "recall" as QuizDifficulty,
      is_pyq: false,
      image_asset_id: asset._id,
      student_answer: undefined,
      is_correct: undefined,
    };
  });
}

export async function generateQuiz(params: GenerateQuizParams): Promise<QuizGenerateResult> {
  const {
    collegeId, deptId, docId, chapterIndex, studentId, subjectId,
    questionType, difficulty, count, includePyq, timed, timeLimitPerQuestion, conn,
  } = params;

  // 1. Load chapter metadata
  const ChapterMap = getChapterMapModel(conn);
  const chapterMap = await ChapterMap.findOne({ doc_id: docId }).lean();
  const chapter = chapterMap?.chapters.find(c => c.chapter_index === chapterIndex);
  if (!chapter) throw new Error(`Chapter ${chapterIndex} not found`);

  // F-17-G: image-label questions bypass the LLM entirely — built directly from ImageAsset records
  if (questionType === "IMAGE_LABEL") {
    const imageQuestions = await generateImageLabelQuestions(collegeId, docId, chapter.start_page, chapter.end_page, count, conn);
    if (imageQuestions.length === 0) {
      throw new Error("No labelled diagrams available for this chapter yet");
    }

    const QuizSession = getQuizSessionModel(conn);
    const session = await QuizSession.create({
      _id: randomUUID(),
      student_id: studentId,
      doc_id: docId,
      chapter_index: chapterIndex,
      subject_id: subjectId,
      college_id: collegeId,
      dept_id: deptId,
      quiz_mode: "practice",
      question_type: questionType,
      difficulty,
      time_limit_seconds: null,
      questions: imageQuestions,
      status: "in_progress",
      total_count: imageQuestions.length,
      started_at: new Date(),
    });

    return {
      quiz_session_id: session._id,
      questions: imageQuestions,
      total_count: imageQuestions.length,
      time_limit_seconds: null,
    };
  }

  // 2. Fetch chapter chunks from Pinecone
  const chunks = await fetchChapterChunks(collegeId, deptId, docId, chapter.start_page, chapter.end_page);
  if (chunks.length === 0) throw new Error("No content indexed for this chapter");

  const contextText = chunks.map(c => `[Page ${c.page_num}] ${c.text}`).join("\n\n").slice(0, QUIZ_MAX_CONTEXT);

  // 3. Fetch PYQ examples if requested
  let pyqExamplesText = "";
  if (includePyq && chapter.pyq_count > 0) {
    const PYQQuestion = getPYQQuestionModel(conn);
    const pyqSamples = await PYQQuestion.find({
      _id: { $in: chapter.pyq_question_ids.slice(0, 5) },
    }).lean();
    if (pyqSamples.length > 0) {
      pyqExamplesText = "\n\nExam style examples from past papers:\n" +
        pyqSamples.map(q => `(${q.year}, ${q.marks}m): ${q.question_text}`).join("\n");
    }
  }

  // 4. Build prompt
  const systemPrompt = `You are an expert medical exam question generator.
Generate questions STRICTLY from the provided chapter content.
Respond ONLY with a valid JSON array. No preamble, no markdown code fences, no explanation.
Each question object must follow this exact schema:
{
  "question_text": "...",
  "question_type": "${questionType === "MIXED" ? "MCQ" : questionType}",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correct_answer": "A",
  "explanation": "Brief explanation citing the source",
  "source_page": 215,
  "bloom_level": "remember | understand | apply | analyse",
  "difficulty": "${difficulty}"
}
For SAQ/LAQ: options = [], correct_answer = key answer points as a string.
For TF: options = ["True", "False"], correct_answer = "True" or "False".`;

  const userPrompt = `Generate ${count} ${questionType} questions at ${difficulty} level.
Chapter ${chapter.chapter_index}: "${chapter.title}" (pages ${chapter.start_page}–${chapter.end_page})${pyqExamplesText}

Chapter content:
${contextText}`;

  // 5. Call Claude Sonnet
  const response = await getClient().messages.create({
    model:      QUIZ_GENERATION_MODEL,
    max_tokens: QUIZ_MAX_TOKENS,
    system:     systemPrompt,
    messages:   [{ role: "user", content: userPrompt }],
  });

  const rawText = response.content[0].type === "text" ? response.content[0].text : "";
  const aiQuestions = parseQuizJson(rawText);

  // 6. Optionally append real PYQ questions
  let finalQuestions = aiQuestions.slice(0, count);
  if (includePyq && chapter.pyq_count > 0) {
    const PYQQuestion = getPYQQuestionModel(conn);
    const realPyqs = await PYQQuestion.find({
      _id: { $in: chapter.pyq_question_ids.slice(0, 3) },
    }).lean();

    const pyqFormatted: QuizQuestion[] = realPyqs.map(q => ({
      question_id:    randomUUID(),
      question_text:  q.question_text,
      question_type:  q.question_type as QuizQuestionType,
      options:        [],
      correct_answer: "",
      explanation:    `Appeared in ${q.exam_name} (${q.marks} marks)`,
      source_page:    undefined,
      bloom_level:    "apply",
      difficulty:     "application" as QuizDifficulty,
      is_pyq:         true,
      pyq_question_id: String(q._id),
      pyq_year:       q.year,
      student_answer: undefined,
      is_correct:     undefined,
    }));
    finalQuestions = [...finalQuestions, ...pyqFormatted];
  }

  // 7. Create quiz session
  const timeLimit = timed && timeLimitPerQuestion
    ? (timeLimitPerQuestion * finalQuestions.length)
    : null;

  const mode: QuizMode = timed ? "timed" : "practice";

  const QuizSession = getQuizSessionModel(conn);
  const session = await QuizSession.create({
    _id:           randomUUID(),
    student_id:    studentId,
    doc_id:        docId,
    chapter_index: chapterIndex,
    subject_id:    subjectId,
    college_id:    collegeId,
    dept_id:       deptId,
    quiz_mode:     mode,
    question_type: questionType,
    difficulty,
    time_limit_seconds: timeLimit,
    questions:     finalQuestions,
    status:        "in_progress",
    total_count:   finalQuestions.length,
    started_at:    new Date(),
  });

  return {
    quiz_session_id: session._id,
    questions:       finalQuestions,
    total_count:     finalQuestions.length,
    time_limit_seconds: timeLimit,
  };
}

// ─── Answer submission ────────────────────────────────────────────────────────

export async function submitSingleAnswer(
  sessionId: string,
  questionId: string,
  studentAnswer: string,
  conn: Connection,
): Promise<{ is_correct: boolean; correct_answer: string; explanation: string }> {
  const QuizSession = getQuizSessionModel(conn);
  const session = await QuizSession.findById(sessionId).lean();
  if (!session) throw new Error("Session not found");

  const question = session.questions.find(q => q.question_id === questionId);
  if (!question) throw new Error("Question not found");

  const isCorrect = question.question_type === "MCQ" || question.question_type === "TF" || question.question_type === "IMAGE_LABEL"
    ? studentAnswer.trim().toUpperCase() === question.correct_answer.trim().toUpperCase()
    : studentAnswer.trim().length > 0; // SAQ/LAQ — attempt = credit (detailed grading in future)

  await QuizSession.updateOne(
    { _id: sessionId, "questions.question_id": questionId },
    {
      $set: {
        "questions.$.student_answer":     studentAnswer,
        "questions.$.is_correct":         isCorrect,
        "questions.$.answered_at":        new Date(),
      },
    },
  );

  return { is_correct: isCorrect, correct_answer: question.correct_answer, explanation: question.explanation };
}

// ─── Exam readiness ───────────────────────────────────────────────────────────

function extractWeakTopics(wrongQuestions: QuizQuestion[]): string[] {
  const stopwords = new Set(["the", "a", "an", "of", "in", "is", "are", "was", "were", "to", "and", "or", "for", "with", "which", "that", "this", "its", "by", "at"]);
  const freq = new Map<string, number>();

  for (const q of wrongQuestions) {
    const words = q.question_text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
    for (const w of words) {
      if (!stopwords.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
}

export async function computeExamReadiness(
  sessionId: string,
  conn: Connection,
): Promise<{
  score_pct: number;
  correct_count: number;
  total_count: number;
  weak_topics: string[];
  strong_topics: string[];
  pyq_coverage_pct: number;
  pyq_would_pass_count: number;
  recommendation: string;
}> {
  const QuizSession = getQuizSessionModel(conn);
  const session = await QuizSession.findById(sessionId).lean();
  if (!session) throw new Error("Session not found");

  const answered    = session.questions.filter(q => q.student_answer != null);
  const correct     = answered.filter(q => q.is_correct);
  const wrong       = answered.filter(q => !q.is_correct);
  const correctPct  = answered.length > 0 ? Math.round((correct.length / answered.length) * 100) : 0;

  const weakTopics   = extractWeakTopics(wrong);
  const strongTopics = extractWeakTopics(correct).slice(0, 3);

  // PYQ estimate (proxy: use session score as chapter mastery)
  const ChapterMap = getChapterMapModel(conn);
  const chapterMap = await ChapterMap.findOne({ doc_id: session.doc_id }).lean();
  const chapter = chapterMap?.chapters.find(c => c.chapter_index === session.chapter_index);
  const pyqCount = chapter?.pyq_count ?? 0;
  const pyqWouldPass = Math.round((correctPct / 100) * pyqCount);
  const pyqCoveragePct = pyqCount > 0 ? Math.round((pyqWouldPass / pyqCount) * 100) : 0;

  // Generate recommendation (Claude Haiku, non-blocking)
  let recommendation = "";
  try {
    const prompt = `Student scored ${correctPct}% on Chapter ${session.chapter_index}.
Weak topics: ${weakTopics.join(", ") || "none identified"}.
Strong topics: ${strongTopics.join(", ") || "none"}.
Estimated ${pyqWouldPass} of ${pyqCount} real exam questions answered correctly.
Give a 2-sentence study recommendation. Be specific. Reference the chapter.`;

    const msg = await getClient().messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages:   [{ role: "user", content: prompt }],
    });
    recommendation = msg.content[0].type === "text" ? msg.content[0].text : "";
  } catch { /* non-fatal */ }

  const result = {
    score_pct:            correctPct,
    correct_count:        correct.length,
    total_count:          answered.length,
    weak_topics:          weakTopics,
    strong_topics:        strongTopics,
    pyq_coverage_pct:     pyqCoveragePct,
    pyq_would_pass_count: pyqWouldPass,
    recommendation,
  };

  // Persist to session
  await QuizSession.findByIdAndUpdate(sessionId, {
    $set: {
      status:               "completed",
      completed_at:         new Date(),
      ...result,
    },
  });

  return result;
}
