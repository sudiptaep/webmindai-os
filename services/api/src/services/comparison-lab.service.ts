import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { LLM_MODEL_CHAT, type ComparisonRun, type ComparisonFailureSignature, type ComparisonRunSource } from "@college-chatbot/shared";
import { getCollegeDb } from "../db/college.db";
import { getDocumentModel } from "../models/college/document.model";
import { getComparisonRunModel } from "../models/college/comparison-run.model";
import { runRAG } from "./rag.service";

const FRONTIER_MODEL = process.env.COMPARISON_LAB_FRONTIER_MODEL ?? "claude-opus-4-8";
const JUDGE_MODEL = process.env.COMPARISON_LAB_JUDGE_MODEL ?? LLM_MODEL_CHAT;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

interface GroundedResult {
  text: string;
  sources: ComparisonRunSource[];
  topRerankScore: number;
  latencyMs: number;
  tokensUsed: number;
}

interface FrontierResult {
  text: string;
  latencyMs: number;
  tokensUsed: number;
}

interface JudgeResult {
  faithfulness: number;
  completeness: number;
  citationAccurate: boolean;
  reasoning: string;
}

/** Builds the doc scope for a dept (+ optional subject) so runRAG has something to query. */
async function resolveNamespacedDocs(collegeId: string, deptId: string, subjectId?: string) {
  const conn = await getCollegeDb(collegeId);
  const Document = getDocumentModel(conn);
  const filter: Record<string, unknown> = { dept_id: deptId, ingestion_status: "completed" };
  if (subjectId) filter.subject_id = subjectId;

  const docs = await Document.find(filter, { _id: 1 }).lean();
  return [{ deptId, docIds: docs.map((d) => String(d._id)) }];
}

async function runGroundedPath(params: {
  questionText: string;
  collegeId: string;
  deptId: string;
  subjectId?: string;
}): Promise<GroundedResult> {
  const start = Date.now();
  const namespacedDocs = await resolveNamespacedDocs(params.collegeId, params.deptId, params.subjectId);

  let text = "";
  let sources: ComparisonRunSource[] = [];
  let topRerankScore = 0;
  let tokensUsed = 0;

  // Unique cacheScope per run — the semantic cache must never mask a real
  // regression (e.g. a document re-ingest that changed retrieval quality).
  // metering IS passed through — this calls the real production pipeline
  // (embedding, Pinecone, Cohere rerank, Anthropic generation all cost real
  // money) so lab runs must show up in cost tracking like any other query.
  for await (const event of runRAG({
    query: params.questionText,
    collegeId: params.collegeId,
    cacheScope: `comparison-lab:${randomUUID()}`,
    namespacedDocs,
    sessionMessages: [],
    metering: { deptId: params.deptId },
  })) {
    if (event.type === "token") {
      text += event.content;
    } else if (event.type === "done") {
      tokensUsed = event.tokens_used;
      topRerankScore = event.rerank?.rerank_top_score ?? event.confidence_score;
      sources = event.sources.map((s) => ({
        doc_id: s.doc_id,
        page: s.page,
        chunk_text: s.chunk_preview ?? "",
      }));
    }
  }

  return { text, sources, topRerankScore, latencyMs: Date.now() - start, tokensUsed };
}

async function runFrontierPath(questionText: string): Promise<FrontierResult> {
  const start = Date.now();
  const response = await getClient().messages.create({
    model: FRONTIER_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: questionText }],
    system: "Answer this academic question using your general knowledge. Do not mention that you lack access to any specific textbook.",
  });
  const block = response.content[0];
  return {
    text: block.type === "text" ? block.text : "",
    latencyMs: Date.now() - start,
    tokensUsed: response.usage.output_tokens,
  };
}

async function runFaithfulnessJudge(grounded: GroundedResult, question: string): Promise<JudgeResult> {
  const judgePrompt = `You are evaluating whether an AI's answer is faithfully grounded in its cited source.

Question: "${question}"
AI's answer: "${grounded.text}"
Cited source text: "${grounded.sources.map((s) => s.chunk_text).join("\n---\n")}"

Score on three dimensions (JSON only, no markdown):
{
  "faithfulness": 0.0-1.0,
  "completeness": 0.0-1.0,
  "citation_accurate": true/false,
  "reasoning": "1-2 sentence explanation"
}`;

  const response = await getClient().messages.create({
    model: JUDGE_MODEL,
    max_tokens: 300,
    messages: [{ role: "user", content: judgePrompt }],
  });
  const block = response.content[0];
  const raw = block.type === "text" ? block.text.trim() : "{}";

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ""));
    return {
      faithfulness: Number(parsed.faithfulness) || 0,
      completeness: Number(parsed.completeness) || 0,
      citationAccurate: Boolean(parsed.citation_accurate),
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return { faithfulness: 0, completeness: 0, citationAccurate: false, reasoning: "Judge response could not be parsed." };
  }
}

function classifyFailure(judge: JudgeResult, frontier: FrontierResult): ComparisonFailureSignature {
  if (judge.faithfulness >= 0.8 && judge.citationAccurate) return "none";
  if (judge.faithfulness < 0.5 && frontier.text.length > 100) return "extraction_failure";
  if (judge.faithfulness >= 0.5 && !judge.citationAccurate) return "retrieval_failure";
  return "expected_divergence";
}

export async function runComparison(params: {
  questionText: string;
  deptId: string;
  collegeId: string;
  subjectId?: string;
  goldenQuestionId?: string;
}): Promise<ComparisonRun> {
  const [grounded, frontier] = await Promise.all([
    runGroundedPath({
      questionText: params.questionText,
      collegeId: params.collegeId,
      deptId: params.deptId,
      subjectId: params.subjectId,
    }),
    runFrontierPath(params.questionText),
  ]);

  const judge = await runFaithfulnessJudge(grounded, params.questionText);
  const failureSignature = classifyFailure(judge, frontier);

  const conn = await getCollegeDb(params.collegeId);
  const ComparisonRunModel = getComparisonRunModel(conn);

  const run = await ComparisonRunModel.create({
    _id: randomUUID(),
    golden_question_id: params.goldenQuestionId,
    question_text: params.questionText,
    dept_id: params.deptId,
    college_id: params.collegeId,
    grounded_response_text: grounded.text,
    grounded_sources: grounded.sources,
    grounded_retrieval_score: grounded.topRerankScore,
    grounded_latency_ms: grounded.latencyMs,
    grounded_tokens_used: grounded.tokensUsed,
    frontier_model: FRONTIER_MODEL,
    frontier_response_text: frontier.text,
    frontier_latency_ms: frontier.latencyMs,
    frontier_tokens_used: frontier.tokensUsed,
    faithfulness_score: judge.faithfulness,
    completeness_score: judge.completeness,
    citation_accuracy: judge.citationAccurate,
    judge_reasoning: judge.reasoning,
    failure_signature: failureSignature,
  });

  return run.toObject();
}
