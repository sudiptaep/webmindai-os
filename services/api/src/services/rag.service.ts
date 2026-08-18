import {
  CONFIDENCE_THRESHOLD,
  IMAGE_CONFIDENCE_THRESHOLD,
  IMAGE_TOP_K,
  RAG_TOP_K_RETRIEVE,
  RAG_CONVERSATION_TURNS,
  RAG_ADAPTIVE_TOPK_SIMPLE,
  RAG_ADAPTIVE_TOPK_MULTIPART,
  RAG_ADAPTIVE_TOPK_CASE,
  RAG_MMR_LAMBDA,
  RAG_RERANK_ANSWER_THRESHOLD,
  RAG_RERANK_CONFIDENT_THRESHOLD,
  LLM_MODEL_EXAM,
  LLM_CONTINUATION_MAX_TOKENS,
  type SourceCitation,
  type Chapter,
  type ImageAsset,
  type ImageToken,
  type QueryComplexity,
  type ParentChunk,
} from "@college-chatbot/shared";
import { embedQuery } from "./embedding.service";
import { queryMultiNamespace, queryMultiNamespaceSparse, queryImageMultiNamespace, queryChapterScoped, queryDocUnscoped, type PineconeChunk } from "./pinecone.service";
import { streamChatResponse, generateExamQuestions } from "./llm.service";
import { getCachedResponse, setCachedResponse } from "./cache.service";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "./metering.service";
import { rewriteQueryForRetrieval } from "./query-rewrite.service";
import { rerankChunks } from "./cohere-rerank.service";
import { encodeQuerySparse } from "./bm25.service";
import { reciprocalRankFusion } from "./hybrid-fusion";
import { getCollegeDb } from "../db/college.db";
import { getImageAssetModel } from "../models/college/image-asset.model";
import { getParentChunkModel } from "../models/college/parent-chunk.model";
import { getDepartmentModel } from "../models/college/department.model";
import { getDocumentModel } from "../models/college/document.model";
import { getSubjectModel } from "../models/college/subject.model";
import { generateFileToken, TOKEN_TTL } from "./file-token.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RAGEvent =
  | { type: "status"; message: string }
  | { type: "token"; content: string }
  | {
      type: "done";
      sources: SourceCitation[];
      confidence_score: number;
      answered: boolean;
      tokens_used: number;
      images: ImageToken[];
      // F-19-E: three-band rerank-score confidence — undefined only for the cached-response path
      answer_confidence_band?: ConfidenceBand;
      // F-18-B: retrieval telemetry — undefined for exam/no-answer/cached paths
      retrieval?: {
        retrieved_chunk_ids: string[];
        cited_chunk_ids: string[];
        retrieval_precision: number;
        query_complexity: QueryComplexity;
        top_k_used: number;
        mmr_applied: boolean;
        query_rewritten_text: string;
        // F-19-C: conversational query rewriting telemetry
        rewrite_applied: boolean;
        resolved_entities: string[];
        // F-19-B: small-to-big expansion telemetry
        child_chunks_retrieved: number;
        parent_chunks_used: number;
        parent_expansion_ratio: number;
        // F-19-D: metadata pre-filtering telemetry — 1 = tightest tier used
        retrieval_tier: number;
      };
      // F-18-C: rerank monitoring — undefined if the candidate pool was empty
      rerank?: {
        rerank_top_score: number;
        rerank_score_spread: number;
        rerank_candidate_count: number;
      };
      // F-18-D: truncation telemetry — undefined for exam/no-answer/cached paths
      truncation?: {
        stop_reason: string | null;
        was_truncated: boolean;
        was_truncated_and_continued: boolean;
      };
    };

export interface RAGMeteringContext {
  deptId: string;
  studentId?: string | null;
  sessionId?: string | null;
}

export type NamespacedDocs = Array<{ deptId: string; docIds: string[] }>;

// F-19-G: query modes MMR's diversity penalty is meant for vs. modes it harms.
// disease_cross_subject/general_dept_search genuinely want breadth across
// distinct topics; everything else here wants depth on ONE topic, where
// penalising similar-to-already-selected chunks throws away the very
// chunks that complete the answer (e.g. three consecutive textbook chunks
// all about the same mechanism — that's not redundancy, that's the answer).
export type QueryMode =
  | "standard_chat"
  | "chapter_scoped_chat"
  | "quiz_generation"
  | "clinical_case"
  | "disease_cross_subject"
  | "general_dept_search";

export interface RAGParams {
  query: string;
  collegeId: string;
  /** Cache key discriminator — e.g. "${collegeId}:year${N}" */
  cacheScope: string;
  /**
   * F-19-D: metadata pre-filtering cascade, tightest first — e.g.
   * [currentSemesterDocs, currentYearDocs, allDeptDocs]. Tier 1 is tried
   * first; if it returns too few matches, the next (broader) tier is tried,
   * down to the last tier which must never be empty-by-construction.
   * A single-element array disables cascading (always uses that one tier).
   */
  tieredNamespacedDocs: NamespacedDocs[];
  sessionMessages: Array<{ role: "user" | "assistant"; content: string }>;
  metering?: RAGMeteringContext;
  /** F-19-G: gates MMR — defaults to "standard_chat" (MMR off) when omitted. */
  queryMode?: QueryMode;
}

// ─── BM25 in-memory re-ranker ─────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const BM25_DENSE_WEIGHT = 0.4; // weight for dense (Pinecone) score in hybrid merge

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b\w+\b/g) ?? [];
}

function bm25Merge(query: string, chunks: PineconeChunk[]): PineconeChunk[] {
  if (chunks.length === 0) return chunks;

  const queryTerms = tokenize(query);
  const tokenizedDocs = chunks.map((c) => tokenize(c.text));
  const avgdl = tokenizedDocs.reduce((s, d) => s + d.length, 0) / tokenizedDocs.length;
  const N = chunks.length;

  // document frequency per term
  const df = new Map<string, number>();
  for (const terms of tokenizedDocs) {
    const unique = new Set(terms);
    for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
  }

  // IDF per query term
  const idf = new Map<string, number>();
  for (const t of queryTerms) {
    const dfVal = df.get(t) ?? 0;
    idf.set(t, Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1));
  }

  // BM25 score per doc
  const bm25Scores = tokenizedDocs.map((terms, i) => {
    const dl = terms.length;
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const t of queryTerms) {
      const tfVal = tf.get(t) ?? 0;
      if (tfVal === 0) continue;
      const idfVal = idf.get(t) ?? 0;
      score += idfVal * (tfVal * (BM25_K1 + 1)) / (tfVal + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl));
    }
    return { idx: i, score };
  });

  // normalize both score sets to [0,1]
  const maxBm25 = Math.max(...bm25Scores.map((s) => s.score), 1e-9);
  const maxDense = Math.max(...chunks.map((c) => c.score), 1e-9);

  return chunks
    .map((chunk, i) => ({
      ...chunk,
      score:
        BM25_DENSE_WEIGHT * (chunk.score / maxDense) +
        (1 - BM25_DENSE_WEIGHT) * (bm25Scores[i].score / maxBm25),
    }))
    .sort((a, b) => b.score - a.score);
}

// ─── True hybrid search + RRF (F-19-F) ────────────────────────────────────────

// Opt-in: requires a sparse-capable Pinecone index (dotproduct metric or a
// dedicated sparse index) plus a BM25 encoder fitted per department. Neither
// exists until an admin runs the fit + provisions the index, so this stays
// off by default — flipping it on without both prerequisites just means every
// query silently falls back to bm25Merge below (encodeQuerySparse returns
// null when no encoder is fitted).
const HYBRID_SEARCH_ENABLED = process.env.HYBRID_SEARCH_ENABLED === "true";
const HYBRID_SPARSE_TOP_K = Number(process.env.HYBRID_SPARSE_TOP_K ?? 30);
const RRF_K_CONSTANT = Number(process.env.RRF_K_CONSTANT ?? 60);

/**
 * Fuses the already-retrieved dense candidate pool with an independent sparse
 * (BM25) retrieval pass via Reciprocal Rank Fusion — genuine hybrid recall,
 * not just a lexical reweighting of what dense search already found. Falls
 * back to the old in-memory bm25Merge (lexical reranking of the dense pool
 * only) whenever hybrid search is disabled or the department has no fitted
 * BM25 encoder yet.
 */
async function computeHybridRanked(
  collegeId: string,
  deptId: string | null | undefined,
  query: string,
  denseChunks: PineconeChunk[],
  namespacedDocs: NamespacedDocs,
): Promise<{ ranked: PineconeChunk[]; sparseUsed: boolean }> {
  if (HYBRID_SEARCH_ENABLED && deptId) {
    const sparseVector = await encodeQuerySparse(collegeId, deptId, query);
    if (sparseVector) {
      const sparseChunks = await queryMultiNamespaceSparse(collegeId, namespacedDocs, sparseVector, HYBRID_SPARSE_TOP_K);
      const rankedLists = [denseChunks, sparseChunks];
      // Rescale into roughly [0, 1] — same range Cohere/bm25Merge scores use.
      // Cohere normally overwrites this score entirely right after (Step 3b
      // below), but when Cohere is unavailable/fails, THIS is what reaches
      // the F-19-E confidence gate — raw rrf_score (~1/k, e.g. ~0.016 at
      // k=60) compared against thresholds calibrated for 0-1 relevance
      // scores would refuse almost every query regardless of actual
      // relevance. Max possible score is one contribution of 1/(k+1) per
      // list a chunk appears in at rank 0.
      const maxPossibleRrfScore = rankedLists.length / (RRF_K_CONSTANT + 1);
      const fused = reciprocalRankFusion(rankedLists, RRF_K_CONSTANT)
        .map((c) => ({ ...c, score: Math.min(1, c.rrf_score / maxPossibleRrfScore) }));
      return { ranked: dedupeNearDuplicates(fused), sparseUsed: true };
    }
  }
  return { ranked: bm25Merge(query, dedupeNearDuplicates(denseChunks)), sparseUsed: false };
}

// ─── Cohere rerank config (F-18-C) ────────────────────────────────────────────

const RAG_PINECONE_TOP_K = Number(process.env.RAG_PINECONE_TOP_K ?? 20); // widened from 10 — gives the reranker more to work with
const RAG_RERANK_CANDIDATE_MAX = Number(process.env.RAG_RERANK_CANDIDATE_MAX ?? 25); // cost control cap before calling Cohere
const NEAR_DUP_JACCARD_THRESHOLD = 0.9;

/** Removes near-duplicate chunks (same page, >90% word overlap) before they compete for rerank/topK slots. */
function dedupeNearDuplicates(chunks: PineconeChunk[]): PineconeChunk[] {
  const kept: PineconeChunk[] = [];
  const keptWordSets: Set<string>[] = [];

  for (const chunk of chunks) {
    const words = new Set(chunk.text.toLowerCase().match(/\b\w+\b/g) ?? []);
    const isDuplicate = keptWordSets.some((existing) => {
      const intersectionSize = [...words].filter((w) => existing.has(w)).length;
      const unionSize = new Set([...words, ...existing]).size || 1;
      return intersectionSize / unionSize >= NEAR_DUP_JACCARD_THRESHOLD;
    });
    if (!isDuplicate) {
      kept.push(chunk);
      keptWordSets.push(words);
    }
  }
  return kept;
}

// ─── Adaptive top-K by query complexity (F-18-B) ──────────────────────────────

const CASE_KEYWORDS_RE = /patient|presents|case|scenario|year-old/i;

export function classifyQueryComplexity(query: string): QueryComplexity {
  const wordCount = query.split(/\s+/).filter(Boolean).length;
  const hasMultipleQuestionMarks = (query.match(/\?/g) ?? []).length > 1;

  if (CASE_KEYWORDS_RE.test(query)) return "case_based";
  if (hasMultipleQuestionMarks || wordCount > 25) return "multi_part";
  return "simple";
}

const TOP_K_BY_COMPLEXITY: Record<QueryComplexity, number> = {
  simple: RAG_ADAPTIVE_TOPK_SIMPLE,
  multi_part: RAG_ADAPTIVE_TOPK_MULTIPART,
  case_based: RAG_ADAPTIVE_TOPK_CASE,
};

// ─── MMR diversity re-selection (F-18-B, gated per F-19-G) ────────────────────

// Off by default — MMR penalises a chunk for resembling already-selected
// chunks, which is exactly wrong for contiguous textbook prose (three
// consecutive chunks about the same mechanism are highly similar to each
// other BECAUSE they're the answer, not because they're redundant). Small-
// to-big (F-19-B) already collapses same-parent duplicates structurally, so
// most of what MMR was patching over is handled without a relevance penalty.
const MMR_ENABLED_MODES = new Set<QueryMode>(
  (process.env.MMR_ENABLED_MODES ?? "disease_cross_subject,general_dept_search")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean) as QueryMode[],
);

function shouldApplyMMR(queryMode: QueryMode): boolean {
  // MMR_DEFAULT_ENABLED=true is an ops override that ignores the per-mode
  // allowlist entirely and restores the old unconditional-on behavior —
  // for rollback if F-19-G's mode split turns out wrong for some deployment.
  if (process.env.MMR_DEFAULT_ENABLED === "true") return true;
  return MMR_ENABLED_MODES.has(queryMode);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Balances relevance (rerank score) against diversity — avoids near-duplicate chunks in the final selection. */
function selectWithMMR(candidates: PineconeChunk[], k: number, lambda: number): PineconeChunk[] {
  if (candidates.every((c) => !c.values)) return candidates.slice(0, k);

  const selected: PineconeChunk[] = [];
  const remaining = [...candidates];

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSimToSelected = selected.length === 0 || !remaining[i].values
        ? 0
        : Math.max(...selected.map((s) => (s.values ? cosineSimilarity(remaining[i].values!, s.values) : 0)));
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected;
      if (mmrScore > bestScore) { bestScore = mmrScore; bestIdx = i; }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}

// ─── Small-to-big: expand to parent chunks (F-19-B) ───────────────────────────

const SMALL_TO_BIG_ENABLED = process.env.SMALL_TO_BIG_ENABLED !== "false"; // default on

export interface ExpansionTelemetry {
  child_chunks_retrieved: number;
  parent_chunks_used: number;
  parent_expansion_ratio: number; // parents / children — lower = more dedup
}

/**
 * Collapses reranked children down to their unique parents (best child's rank
 * order preserved, dedup as a side effect), fetches full parent text from
 * Mongo, and re-wraps each parent as a PineconeChunk-shaped object so the
 * existing prompt builders / extractSources need no changes.
 *
 * Children with no parent_chunk_id (not yet re-ingested under F-19-B) pass
 * through unchanged — old and new content can coexist during rollout.
 */
async function expandToParents(
  collegeId: string,
  rerankedChildren: PineconeChunk[],
  maxParents: number,
): Promise<{ chunks: PineconeChunk[]; telemetry: ExpansionTelemetry }> {
  const legacyChildren = rerankedChildren.filter((c) => !c.metadata.parent_chunk_id);
  const expandable = rerankedChildren.filter((c) => !!c.metadata.parent_chunk_id);

  if (!SMALL_TO_BIG_ENABLED || expandable.length === 0) {
    return {
      chunks: rerankedChildren,
      telemetry: {
        child_chunks_retrieved: rerankedChildren.length,
        parent_chunks_used: rerankedChildren.length,
        parent_expansion_ratio: 1,
      },
    };
  }

  const bestScoreByParent = new Map<string, number>();
  const orderedParentIds: string[] = [];
  for (const child of expandable) {
    const pid = child.metadata.parent_chunk_id as string;
    if (!bestScoreByParent.has(pid)) {
      bestScoreByParent.set(pid, child.score);
      orderedParentIds.push(pid);
      if (orderedParentIds.length >= maxParents) break;
    }
  }

  const conn = await getCollegeDb(collegeId);
  const ParentChunkModel = getParentChunkModel(conn);
  const parents = await ParentChunkModel.find({ _id: { $in: orderedParentIds } }).lean<ParentChunk[]>();
  const parentById = new Map(parents.map((p) => [p._id, p]));

  const expandedChunks: PineconeChunk[] = orderedParentIds
    .map((pid) => parentById.get(pid))
    .filter((p): p is ParentChunk => !!p)
    .map((parent) => ({
      id: parent._id,
      score: bestScoreByParent.get(parent._id) ?? 0,
      text: parent.text,
      metadata: {
        doc_id: parent.doc_id,
        dept_id: parent.dept_id,
        subject_id: parent.subject_id,
        page_num: parent.page_start,
        page_end: parent.page_end,
        parent_chunk_id: parent._id,
      },
    }));

  // Legacy (un-re-ingested) children keep their own rank position appended
  // after expanded parents rather than interleaved — they're already the
  // smallest unit available for those docs, nothing to expand to.
  const chunks = [...expandedChunks, ...legacyChildren];

  return {
    chunks,
    telemetry: {
      child_chunks_retrieved: rerankedChildren.length,
      parent_chunks_used: chunks.length,
      parent_expansion_ratio: rerankedChildren.length > 0 ? chunks.length / rerankedChildren.length : 1,
    },
  };
}

// ─── Metadata pre-filtering cascade (F-19-D) ──────────────────────────────────

const METADATA_TIER_MIN_RESULTS_RATIO = Number(process.env.METADATA_TIER_MIN_RESULTS_RATIO ?? 0.6);

export interface TierRetrievalResult {
  matches: PineconeChunk[];
  tier: number; // 1-based — which tier of tieredNamespacedDocs was used
  namespacedDocs: NamespacedDocs;
}

/**
 * Tries the tightest doc-scope tier first (e.g. current semester's subjects);
 * if it doesn't return enough matches to be a useful candidate pool, widens
 * to the next tier (e.g. current year, then dept-wide unfiltered). Avoids the
 * all-or-nothing failure mode of a single fixed scope: too tight starves the
 * reranker, too broad (permanently) surfaces content the student hasn't
 * reached yet.
 */
async function retrieveWithMetadataFallback(
  collegeId: string,
  tiers: NamespacedDocs[],
  vector: number[],
  topK: number,
): Promise<TierRetrievalResult> {
  const minResults = Math.ceil(topK * METADATA_TIER_MIN_RESULTS_RATIO);

  for (let i = 0; i < tiers.length; i++) {
    const namespacedDocs = tiers[i];
    const matches = await queryMultiNamespace(collegeId, namespacedDocs, vector, topK, true);
    const isLastTier = i === tiers.length - 1;
    if (matches.length >= minResults || isLastTier) {
      return { matches, tier: i + 1, namespacedDocs };
    }
  }

  // Unreachable when tiers is non-empty, but keeps the function total.
  return { matches: [], tier: tiers.length, namespacedDocs: tiers[tiers.length - 1] ?? [] };
}

// ─── Rerank-score thresholding (F-19-E) ───────────────────────────────────────

const RAG_LEGACY_COSINE_THRESHOLD_ENABLED = process.env.RAG_LEGACY_COSINE_THRESHOLD_ENABLED === "true";

export type ConfidenceBand = "confident" | "hedged" | "refused";

export interface ThresholdGateResult {
  band: ConfidenceBand;
  answered: boolean;
}

const HEDGE_SYSTEM_PROMPT_ADDITION =
  "\n\nIMPORTANT: The retrieved material is only partially relevant to this question. " +
  "Answer what you can from it, and explicitly state which parts of the question are " +
  "not covered in the provided materials.";

interface DeptThresholds {
  answerThreshold: number;
  confidentThreshold: number;
}

/** Department-level overrides on rerank thresholds, falling back to platform defaults. */
async function resolveDeptThresholds(collegeId: string, deptId?: string | null): Promise<DeptThresholds> {
  const defaults: DeptThresholds = {
    answerThreshold: RAG_RERANK_ANSWER_THRESHOLD,
    confidentThreshold: RAG_RERANK_CONFIDENT_THRESHOLD,
  };
  if (!deptId) return defaults;

  try {
    const conn = await getCollegeDb(collegeId);
    const dept = await getDepartmentModel(conn).findById(deptId).lean();
    return {
      answerThreshold: dept?.rerank_answer_threshold ?? defaults.answerThreshold,
      confidentThreshold: dept?.rerank_confident_threshold ?? defaults.confidentThreshold,
    };
  } catch {
    return defaults;
  }
}

/**
 * Three-band gate on the top rerank score, replacing F-09's single cosine
 * cutoff. A cross-encoder rerank score is a calibrated relevance judgment
 * trained specifically for this purpose; raw bi-encoder cosine similarity is
 * not comparable across queries, so a single fixed cutoff on it produced both
 * false refusals (a genuinely relevant but lexically distant chunk scoring
 * low) and false confident answers (an irrelevant chunk scoring deceptively
 * high on a short query).
 */
function gateOnRerankScore(maxScore: number, thresholds: DeptThresholds): ThresholdGateResult {
  if (RAG_LEGACY_COSINE_THRESHOLD_ENABLED) {
    return { band: maxScore >= CONFIDENCE_THRESHOLD ? "confident" : "refused", answered: maxScore >= CONFIDENCE_THRESHOLD };
  }
  if (maxScore < thresholds.answerThreshold) return { band: "refused", answered: false };
  if (maxScore < thresholds.confidentThreshold) return { band: "hedged", answered: true };
  return { band: "confident", answered: true };
}

// ─── Exam detection ───────────────────────────────────────────────────────────

const EXAM_PATTERNS = [
  /generate.{0,20}(exam|test|quiz|question)/i,
  /question.{0,20}paper/i,
  /(previous.?year|pyq|past.?year)/i,
  /practice.{0,10}questions?/i,
  /make.{0,10}(exam|quiz)/i,
];

export function isExamRequest(query: string): boolean {
  return EXAM_PATTERNS.some((p) => p.test(query));
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

/**
 * Strips markdown the student UI renders as literal characters instead of
 * formatting (bold markers, heading hashes) and em dashes (a stylistic tic
 * that reads as stiff/AI-written). The system prompt also asks the model not
 * to use these, but this is the guarantee, not the request.
 */
function stripMarkdownArtifacts(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s*—\s*/g, ", ");
}

function buildChatSystemPrompt(chunks: PineconeChunk[]): string {
  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.text}`)
    .join("\n\n");

  return `You are an expert academic tutor helping students deeply understand their course material. You're talking to the student directly, like a knowledgeable senior explaining something in a conversation — not writing a report or a textbook entry.

Follow these rules:
1. Answer ONLY from the context chunks below — never fabricate or guess facts not present in the material.
2. Be thorough: explain concepts fully, including definitions, mechanisms, causes, effects, and clinical/practical significance where applicable — but write it as connected prose, the way you'd actually explain it out loud, not as a list of labelled facts.
3. Explain the "why" and "how", not just the "what" — build conceptual understanding, not just recall.
4. If the context contains multiple relevant chunks, synthesise them into one coherent answer.
5. If the information is genuinely not in the context, say so clearly and do not guess.
6. IMPORTANT: This platform automatically surfaces relevant diagrams and images from the course material alongside your text response. Do NOT say you cannot show images — the UI handles image display separately. If diagrams are listed below under "Relevant diagrams", reference them naturally (e.g. "as shown in the diagram above").
7. Never end mid-sentence or mid-explanation — if you're running long, prioritise finishing your current thought and citing your source over adding more detail.
8. Formatting: write in plain paragraphs. Do NOT use bold markdown (**text**), heading markers (##, ###), or em dashes (—) — the student UI renders bold/headings as literal characters, and em dashes read as stiff/AI-written. Use commas, periods, or parentheses instead. A short bullet or numbered list is fine when you're genuinely listing discrete items (e.g. steps, causes), but don't default to headings or a rigid report structure — most answers should just read like a well-explained paragraph or two.

CONTEXT:
${context}`;
}

function buildExamSystemPrompt(chunks: PineconeChunk[]): string {
  const context = chunks.map((c) => c.text).join("\n\n");

  return `You are an expert academic exam question generator.
Generate questions ONLY from the provided course material context.
Output ONLY valid JSON with no markdown or explanation.

CONTEXT:
${context}`;
}

function buildExamUserMessage(query: string): string {
  return `${query}

Generate exactly:
- 5 short answer questions (2 marks each, key points expected)
- 3 long answer questions (10 marks each, detailed answers expected)
- 10 multiple choice questions (1 mark each, 4 options)

Output this exact JSON structure:
{
  "short_answer": [{"question": "...", "marks": 2}],
  "long_answer": [{"question": "...", "marks": 10}],
  "mcq": [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A", "marks": 1}]
}`;
}

// ─── Image-aware retrieval (F-17) ─────────────────────────────────────────────

async function resolveImageTokens(
  collegeId: string,
  imageChunks: PineconeChunk[],
  studentId?: string | null,
): Promise<ImageToken[]> {
  const topImageChunks = imageChunks
    .filter((c) => c.score >= IMAGE_CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, IMAGE_TOP_K);

  if (topImageChunks.length === 0) return [];

  const conn = await getCollegeDb(collegeId);
  const ImageAssetModel = getImageAssetModel(conn);

  const resolved = await Promise.all(
    topImageChunks.map(async (chunk) => {
      const imageAssetId = chunk.metadata.image_asset_id as string | undefined;
      if (!imageAssetId) return null;

      const asset = await ImageAssetModel.findById(imageAssetId).lean<ImageAsset>();
      if (!asset || asset.hidden) return null;

      const tokenBase = {
        college_id: collegeId,
        dept_id: asset.dept_id,
        student_id: studentId ?? "",
        doc_id: asset.doc_id,
        mime_type: "image/jpeg",
        single_use: false,
      } as const;

      const [viewToken, thumbToken] = await Promise.all([
        generateFileToken({ ...tokenBase, file_path: asset.file_path, intent: "preview", filename: `image_${asset._id}.jpg` }, TOKEN_TTL.preview),
        generateFileToken({ ...tokenBase, file_path: asset.thumbnail_path, intent: "preview", filename: `image_${asset._id}_thumb.jpg` }, TOKEN_TTL.preview),
      ]);

      const imageToken: ImageToken = {
        image_asset_id: asset._id,
        token_url: `/files/serve?token=${viewToken}`,
        thumbnail_url: `/files/serve?token=${thumbToken}`,
        caption: asset.caption ?? "",
        image_type: asset.image_type ?? "other",
        source_page: asset.source_page,
        doc_filename: (chunk.metadata.filename as string) ?? "",
        alt_text: asset.alt_text ?? "",
        labels: asset.labels_extracted ?? [],
        relevance_score: chunk.score,
      };
      return imageToken;
    }),
  );

  return resolved.filter((t): t is ImageToken => t !== null);
}

function buildImageCaptionContext(images: ImageToken[]): string {
  if (images.length === 0) return "";
  return (
    "\n\nRelevant diagrams being shown to the student:\n" +
    images.map((img) => `- ${img.caption} (Page ${img.source_page}, ${img.image_type})`).join("\n")
  );
}

// ─── Source extraction ────────────────────────────────────────────────────────

/**
 * Resolves real book/document names and subject names from Mongo rather than
 * Pinecone metadata — chunk metadata was never given an original_filename
 * field at ingestion (only doc_id/subject_id), so filename always came back
 * empty and subject was a raw subject_id UUID, not a name. The frontend
 * showed the empty filename's "Document" fallback with that UUID printed
 * next to it. Works retroactively for already-ingested content — no
 * re-ingestion needed, since this reads Document/Subject records directly.
 */
async function extractSources(collegeId: string, chunks: PineconeChunk[]): Promise<SourceCitation[]> {
  const seen = new Set<string>();
  const entries: Array<{ docId: string; page?: number; subjectId?: string; chunkPreview: string }> = [];

  for (const chunk of chunks) {
    const docId = chunk.metadata.doc_id as string | undefined;
    if (!docId || seen.has(docId)) continue;
    seen.add(docId);

    entries.push({
      docId,
      // page_num is what F-19-B hierarchical chunks (and expanded parents) carry;
      // section_index is the legacy field from pre-F-19-B ingestion.
      page: chunk.metadata.page_num != null
        ? (chunk.metadata.page_num as number)
        : chunk.metadata.section_index != null
          ? (chunk.metadata.section_index as number) + 1
          : undefined,
      subjectId: chunk.metadata.subject_id as string | undefined,
      chunkPreview: chunk.text.slice(0, 120),
    });
  }

  if (entries.length === 0) return [];

  const conn = await getCollegeDb(collegeId);
  const docIds = entries.map((e) => e.docId);
  const subjectIds = [...new Set(entries.map((e) => e.subjectId).filter((s): s is string => !!s))];

  const [docs, subjects] = await Promise.all([
    getDocumentModel(conn).find({ _id: { $in: docIds } }, { original_filename: 1 }).lean(),
    subjectIds.length > 0
      ? getSubjectModel(conn).find({ _id: { $in: subjectIds } }, { name: 1 }).lean()
      : Promise.resolve([]),
  ]);
  const filenameById = new Map(docs.map((d) => [String(d._id), d.original_filename]));
  const subjectNameById = new Map(subjects.map((s) => [String(s._id), s.name]));

  const sources: SourceCitation[] = entries.map((e) => ({
    doc_id: e.docId,
    filename: filenameById.get(e.docId) ?? "",
    page: e.page,
    subject: e.subjectId ? subjectNameById.get(e.subjectId) : undefined,
    chunk_preview: e.chunkPreview,
  }));

  return sources;
}

// ─── RAG pipeline ────────────────────────────────────────────────────────────

export async function* runRAG(params: RAGParams): AsyncGenerator<RAGEvent> {
  const { query, collegeId, cacheScope, tieredNamespacedDocs, sessionMessages, metering, queryMode = "standard_chat" } = params;

  // Semantic cache check (skip for exam requests — always fresh)
  if (!isExamRequest(query)) {
    const cached = await getCachedResponse(query, cacheScope);
    if (cached) {
      yield { type: "token", content: cached.tokens };
      yield {
        type: "done",
        sources: cached.sources as SourceCitation[],
        confidence_score: cached.confidence_score,
        answered: cached.answered,
        tokens_used: 0,
        images: [],
      };
      return;
    }
  }

  yield { type: "status", message: "Reading your question…" };

  const embeddingMetering = metering
    ? { collegeId, deptId: metering.deptId, actionType: "query_embedding" as const, studentId: metering.studentId }
    : undefined;

  // Step 1-2: Rewrite query for retrieval (embedding only — original query still
  // drives BM25/LLM/UI), then embed. Also classify complexity for adaptive top-K.
  const queryComplexity = classifyQueryComplexity(query);
  const adaptiveTopK = TOP_K_BY_COMPLEXITY[queryComplexity];
  const rewrite = await rewriteQueryForRetrieval(
    query,
    sessionMessages,
    undefined,
    metering ? { collegeId, deptId: metering.deptId, studentId: metering.studentId, sessionId: metering.sessionId } : undefined,
  );
  const queryVector = await embedQuery(rewrite.rewritten_query, embeddingMetering);

  yield { type: "status", message: "Searching your course materials…" };

  // Step 3: Dense retrieval — metadata pre-filtering cascade (F-19-D) tries the
  // tightest doc scope first and widens only if it comes up short; images use
  // whichever tier the text retrieval settled on, run in parallel with it once
  // that's resolved so image vectors never compete with text for topK slots.
  // includeValues=true on the text query so MMR (Step 4) can compute similarity.
  // Pool widened to RAG_PINECONE_TOP_K (F-18-C) — a narrow top-10 meant the
  // reranker could only reorder chunks it was given, never recover a correct
  // chunk that fell outside that initial window.
  const { matches: retrieved, tier: retrievalTier, namespacedDocs } =
    await retrieveWithMetadataFallback(collegeId, tieredNamespacedDocs, queryVector, RAG_PINECONE_TOP_K);
  const imageChunks = await queryImageMultiNamespace(collegeId, namespacedDocs, queryVector);

  // Meter Pinecone reads (one query per tier tried, plus one image query per namespace)
  if (metering && namespacedDocs.length > 0) {
    const namespacesQueried = namespacedDocs.filter((n) => n.docIds.length > 0).length;
    const pineconeRate = await getRateTable("pinecone", "serverless");
    const readUnits = namespacesQueried * retrievalTier + namespacesQueried;
    const costUsd = (readUnits / 1_000_000) * pineconeRate.per_unit_cost;
    recordCostEvent({
      college_id:        collegeId,
      dept_id:           metering.deptId,
      student_id:        metering.studentId ?? undefined,
      session_id:        metering.sessionId ?? undefined,
      action_type:       "pinecone_read",
      service:           "pinecone",
      model:             "serverless",
      vector_read_units: readUnits,
      cost_usd:          costUsd,
      billing_month:     getBillingMonth(),
      billing_day:       getBillingDay(),
      created_at:        new Date(),
    });
  }

  // Step 3a: True hybrid search + RRF (F-19-F) on text chunks only (images
  // already semantically filtered) — independent sparse retrieval fused with
  // dense via rank position, falling back to lexical-only reranking of the
  // dense pool when hybrid search is unavailable. Uses the ORIGINAL query —
  // the rewrite is for embedding match quality, not keyword match.
  const { ranked: hybridRanked, sparseUsed } =
    await computeHybridRanked(collegeId, metering?.deptId, query, retrieved, namespacedDocs);

  if (metering && sparseUsed) {
    const pineconeRate = await getRateTable("pinecone", "serverless");
    const namespacesQueried = namespacedDocs.filter((n) => n.docIds.length > 0).length;
    recordCostEvent({
      college_id:        collegeId,
      dept_id:           metering.deptId,
      student_id:        metering.studentId ?? undefined,
      session_id:        metering.sessionId ?? undefined,
      action_type:       "pinecone_read",
      service:           "pinecone",
      model:             "serverless",
      vector_read_units: namespacesQueried,
      cost_usd:          (namespacesQueried / 1_000_000) * pineconeRate.per_unit_cost,
      billing_month:     getBillingMonth(),
      billing_day:       getBillingDay(),
      created_at:        new Date(),
    });
  }

  yield { type: "status", message: "Reviewing the most relevant sources…" };

  // Step 3b: Cohere cross-encoder rerank (F-18-C) on a capped candidate pool —
  // reorders by true relevance rather than the hybrid fusion / BM25 blend alone.
  const rerankCandidates = hybridRanked.slice(0, RAG_RERANK_CANDIDATE_MAX);
  let cohereRerankTelemetry: { rerank_top_score: number; rerank_score_spread: number; rerank_candidate_count: number } | undefined;
  let cohereReranked = rerankCandidates;

  if (rerankCandidates.length > 0 && process.env.COHERE_API_KEY) {
    try {
      const rerankOutcome = await rerankChunks(query, rerankCandidates.map((c) => c.text), rerankCandidates.length);
      cohereReranked = rerankOutcome.results.map((r) => ({ ...rerankCandidates[r.index], score: r.relevanceScore }));
      cohereRerankTelemetry = {
        rerank_top_score: rerankOutcome.topScore,
        rerank_score_spread: rerankOutcome.scoreSpread,
        rerank_candidate_count: rerankOutcome.candidateCount,
      };
      if (metering) {
        const cohereRate = await getRateTable("cohere", "rerank-english-v3.0");
        recordCostEvent({
          college_id: collegeId,
          dept_id: metering.deptId,
          student_id: metering.studentId ?? undefined,
          session_id: metering.sessionId ?? undefined,
          action_type: "rerank",
          service: "cohere",
          model: "rerank-english-v3.0",
          rerank_units: rerankCandidates.length,
          cost_usd: (rerankCandidates.length / 1000) * cohereRate.per_unit_cost,
          billing_month: getBillingMonth(),
          billing_day: getBillingDay(),
          created_at: new Date(),
        });
      }
    } catch (err) {
      // Cohere outage must never break retrieval — fall back to the BM25 ordering.
      console.error("[rag] Cohere rerank failed, falling back to BM25 ranking:", err);
    }
  }

  // Step 4: MMR diversity re-selection down to the adaptive top-K (F-18-B),
  // gated by query mode (F-19-G) — off for standard_chat (the default), since
  // penalising similar chunks harms contiguous textbook prose. When off, the
  // already rerank-score-sorted pool is simply sliced to top-K.
  const mmrApplied = shouldApplyMMR(queryMode);
  const reranked = mmrApplied
    ? selectWithMMR(cohereReranked, adaptiveTopK, RAG_MMR_LAMBDA)
    : cohereReranked.slice(0, adaptiveTopK);

  // Resolve image matches independently of the text confidence gate below
  const images = await resolveImageTokens(collegeId, imageChunks, metering?.studentId);

  // Step 5: Rerank-score threshold gate (F-19-E) — three bands instead of one
  // fixed cutoff: refuse below the answer threshold, answer-with-hedge in the
  // middle band, answer normally at/above the confident threshold.
  const maxScore = reranked[0]?.score ?? 0;
  const deptThresholds = await resolveDeptThresholds(collegeId, metering?.deptId);
  const { band: confidenceBand, answered } = gateOnRerankScore(maxScore, deptThresholds);

  if (!answered) {
    // Fallback — no streaming needed
    const fallback =
      "I don't have information about this topic in the uploaded course material. Please consult your instructor or course resources.";
    yield { type: "token", content: fallback };
    yield {
      type: "done",
      sources: [],
      confidence_score: maxScore,
      answered: false,
      tokens_used: 0,
      images: [],
      answer_confidence_band: confidenceBand,
    };
    return;
  }

  // Step 5b: Expand surviving children to their parent chunks (F-19-B) — the
  // LLM reads full parent context instead of the narrow slice that matched.
  const { chunks: context, telemetry: expansion } = await expandToParents(collegeId, reranked, adaptiveTopK);

  const llmMetering = metering
    ? {
        collegeId,
        deptId:    metering.deptId,
        studentId: metering.studentId,
        sessionId: metering.sessionId,
        actionType: (isExamRequest(query) ? "exam_generation" : "chat_message") as "chat_message" | "exam_generation",
      }
    : undefined;

  // Exam mode — non-streaming structured JSON response
  if (isExamRequest(query)) {
    yield { type: "status", message: "Generating your questions…" };
    const systemPrompt = buildExamSystemPrompt(context) + (confidenceBand === "hedged" ? HEDGE_SYSTEM_PROMPT_ADDITION : "");
    const userMsg = buildExamUserMessage(query);
    const json = await generateExamQuestions(systemPrompt, userMsg, llmMetering);

    yield { type: "token", content: json };
    yield {
      type: "done",
      sources: await extractSources(collegeId, context),
      confidence_score: maxScore,
      answered: true,
      tokens_used: 0,
      images: [],
      answer_confidence_band: confidenceBand,
    };
    return;
  }

  // Step 6: Assemble conversation context (last N turns)
  const historyWindow = sessionMessages.slice(-RAG_CONVERSATION_TURNS);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...historyWindow,
    { role: "user", content: query },
  ];

  yield { type: "status", message: "Writing your answer…" };

  // Step 7: Stream response — image captions are added to context so the LLM can
  // reference "as shown in the diagram"; the image itself is never sent to the LLM.
  const systemPrompt = buildChatSystemPrompt(context) + buildImageCaptionContext(images) +
    (confidenceBand === "hedged" ? HEDGE_SYSTEM_PROMPT_ADDITION : "");
  const { tokenStream, getUsage, getStopReason } = await streamChatResponse(systemPrompt, messages, undefined, llmMetering);

  let fullResponse = "";
  for await (const token of tokenStream) {
    const clean = stripMarkdownArtifacts(token);
    fullResponse += clean;
    yield { type: "token", content: clean };
  }

  let tokensUsed = await getUsage();
  const stopReason = await getStopReason();
  const wasTruncated = stopReason === "max_tokens";
  let wasTruncatedAndContinued = false;

  // F-18-D: auto-continuation — if the model ran out of tokens mid-answer,
  // ask it to pick up exactly where it left off and keep streaming through
  // the same generator so the student sees one continuous answer.
  if (wasTruncated) {
    const continuation = await streamChatResponse(
      systemPrompt,
      [
        ...messages,
        { role: "assistant", content: fullResponse },
        { role: "user", content: "Please continue your previous answer from exactly where you left off. Do not repeat anything already said." },
      ],
      undefined,
      llmMetering,
      LLM_CONTINUATION_MAX_TOKENS,
    );

    for await (const token of continuation.tokenStream) {
      const clean = stripMarkdownArtifacts(token);
      fullResponse += clean;
      yield { type: "token", content: clean };
    }
    tokensUsed += await continuation.getUsage();
    wasTruncatedAndContinued = true;
  }

  // Step 8: Post-process
  const sources = await extractSources(collegeId, context);

  // Populate semantic cache for future identical queries
  await setCachedResponse(query, cacheScope, {
    tokens: fullResponse,
    sources,
    confidence_score: maxScore,
    answered: true,
  });

  yield {
    type: "done",
    sources,
    confidence_score: maxScore,
    answered: true,
    tokens_used: tokensUsed,
    images,
    answer_confidence_band: confidenceBand,
    retrieval: {
      // "cited" here means "survived MMR into the final prompt", not text-parsed
      // citation matching — no inline citation markers exist in the main chat
      // prompt (only the chapter-scoped path emits "— Page X").
      retrieved_chunk_ids: hybridRanked.map((c) => c.id),
      cited_chunk_ids: reranked.map((c) => c.id),
      retrieval_precision: hybridRanked.length > 0 ? reranked.length / hybridRanked.length : 0,
      query_complexity: queryComplexity,
      top_k_used: adaptiveTopK,
      mmr_applied: mmrApplied,
      query_rewritten_text: rewrite.rewritten_query,
      rewrite_applied: rewrite.rewrite_applied,
      resolved_entities: rewrite.resolved_entities,
      retrieval_tier: retrievalTier,
      ...expansion,
    },
    rerank: cohereRerankTelemetry,
    truncation: {
      stop_reason: stopReason,
      was_truncated: wasTruncated,
      was_truncated_and_continued: wasTruncatedAndContinued,
    },
  };
}

// ─── Chapter-scoped RAG (F-13-C) ─────────────────────────────────────────────

const CHAPTER_TOP_K = 20; // widened alongside RAG_PINECONE_TOP_K (F-18-C rationale) — was 10
const SOCRATIC_HINT_AFTER  = Number(process.env.SOCRATIC_HINT_AFTER_EXCHANGES  ?? 3);
const SOCRATIC_REVEAL_AFTER = Number(process.env.SOCRATIC_REVEAL_AFTER_EXCHANGES ?? 5);

export type ChapterRAGEvent =
  | { type: "status"; message: string }
  | { type: "token"; content: string }
  | {
      type: "done";
      sources: SourceCitation[];
      confidence_score: number;
      answered: boolean;
      tokens_used: number;
      answer_confidence_band?: ConfidenceBand;
      retrieval?: {
        query_complexity: QueryComplexity;
        top_k_used: number;
        mmr_applied: boolean;
        query_rewritten_text: string;
        rewrite_applied: boolean;
        resolved_entities: string[];
      };
      rerank?: { rerank_top_score: number; rerank_score_spread: number; rerank_candidate_count: number };
      truncation?: { stop_reason: string | null; was_truncated: boolean; was_truncated_and_continued: boolean };
    }
  | { type: "fallback"; message: string; suggestion_chapter_index?: number; suggestion_chapter_title?: string };

export interface ChapterRAGParams {
  query: string;
  collegeId: string;
  deptId: string;
  docId: string;
  chapter: Chapter;
  sessionMessages: Array<{ role: "user" | "assistant"; content: string }>;
  mode: "answer" | "socratic";
  /** All chapters of this doc — used for cross-reference fallback */
  allChapters: Chapter[];
  metering?: RAGMeteringContext;
}

function buildChapterSystemPrompt(chapter: Chapter, mode: "answer" | "socratic"): string {
  const base = `You are a study assistant helping a student understand Chapter ${chapter.chapter_index}: "${chapter.title}". Talk to them like you're actually explaining it in a conversation, not writing a textbook entry — plain paragraphs, not a formatted document.
Answer ONLY from the provided context chunks, which are excerpts from pages ${chapter.start_page}–${chapter.end_page}.
Always cite the page number at the end of each relevant point like this: "(Page X)".
If the student asks about a topic not covered in these pages, say: "That topic isn't in this chapter."
Do NOT use bold markdown (**text**), heading markers (##, ###), or em dashes (—) — the student UI renders bold/headings as literal characters, and em dashes read as stiff/AI-written. Use commas, periods, or parentheses instead.`;

  if (mode === "socratic") {
    return `${base}

IMPORTANT: Do NOT give direct answers. Instead:
1. Ask what the student already knows about the topic.
2. Guide them with leading questions toward the answer.
3. Confirm understanding when they get it right.
4. After ${SOCRATIC_HINT_AFTER} exchanges without progress, give a hint (not the full answer).
This is Socratic tutoring — the goal is that THEY reason their way to the answer.`;
  }

  return base;
}

function buildChapterContextPrompt(query: string, chunks: PineconeChunk[], history: Array<{ role: "user" | "assistant"; content: string }>): Array<{ role: "user" | "assistant"; content: string }> {
  const context = chunks
    .map((c, i) => `[${i + 1}] Page ${c.metadata.page_num ?? "?"}: ${c.text}`)
    .join("\n\n");

  const contextMsg = `CONTEXT:\n${context}\n\nQuestion: ${query}`;
  const historyWindow = history.slice(-RAG_CONVERSATION_TURNS);
  return [...historyWindow, { role: "user", content: contextMsg }];
}

function findChapterForPage(allChapters: Chapter[], pageNum: number): Chapter | null {
  return allChapters.find(ch => ch.start_page <= pageNum && ch.end_page >= pageNum) ?? null;
}

export async function* runChapterRAG(params: ChapterRAGParams): AsyncGenerator<ChapterRAGEvent> {
  const { query, collegeId, deptId, docId, chapter, sessionMessages, mode, allChapters, metering } = params;

  yield { type: "status", message: "Reading your question…" };

  const embeddingMetering = metering
    ? { collegeId, deptId, actionType: "query_embedding" as const, studentId: metering.studentId }
    : undefined;

  // 1. Rewrite + embed query (F-19-C) — rewrite used only for retrieval, BM25/LLM/UI still see the raw query.
  // Chapter title doubles as the "subject" hint since it's already in scope here at zero extra cost.
  const queryComplexity = classifyQueryComplexity(query);
  const adaptiveTopK = TOP_K_BY_COMPLEXITY[queryComplexity];
  const rewrite = await rewriteQueryForRetrieval(
    query,
    sessionMessages,
    { subjectName: chapter.title },
    metering ? { collegeId, deptId, studentId: metering.studentId, sessionId: metering.sessionId } : undefined,
  );
  const queryVector = await embedQuery(rewrite.rewritten_query, embeddingMetering);

  yield { type: "status", message: `Searching Chapter ${chapter.chapter_index}…` };

  // 2. Retrieve — scoped to chapter page range, widened pool + embeddings for MMR (F-18-C)
  const retrieved = await queryChapterScoped(
    collegeId, deptId, docId,
    chapter.start_page, chapter.end_page,
    queryVector, CHAPTER_TOP_K, true,
  );

  // Meter Pinecone reads
  if (metering) {
    const pineconeRate = await getRateTable("pinecone", "serverless");
    recordCostEvent({
      college_id:        collegeId,
      dept_id:           deptId,
      student_id:        metering.studentId ?? undefined,
      session_id:        metering.sessionId ?? undefined,
      action_type:       "pinecone_read",
      service:           "pinecone",
      model:             "serverless",
      vector_read_units: 1,
      cost_usd:          1 / 1_000_000 * pineconeRate.per_unit_cost,
      billing_month:     getBillingMonth(),
      billing_day:       getBillingDay(),
      created_at:        new Date(),
    });
  }

  // 3. BM25 hybrid re-rank + dedup, then Cohere cross-encoder rerank (F-18-C)
  const hybridRanked = bm25Merge(query, dedupeNearDuplicates(retrieved));
  const rerankCandidates = hybridRanked.slice(0, RAG_RERANK_CANDIDATE_MAX);
  let cohereRerankTelemetry: { rerank_top_score: number; rerank_score_spread: number; rerank_candidate_count: number } | undefined;
  let cohereReranked = rerankCandidates;

  if (rerankCandidates.length > 0 && process.env.COHERE_API_KEY) {
    try {
      const rerankOutcome = await rerankChunks(query, rerankCandidates.map((c) => c.text), rerankCandidates.length);
      cohereReranked = rerankOutcome.results.map((r) => ({ ...rerankCandidates[r.index], score: r.relevanceScore }));
      cohereRerankTelemetry = {
        rerank_top_score: rerankOutcome.topScore,
        rerank_score_spread: rerankOutcome.scoreSpread,
        rerank_candidate_count: rerankOutcome.candidateCount,
      };
      if (metering) {
        const cohereRate = await getRateTable("cohere", "rerank-english-v3.0");
        recordCostEvent({
          college_id: collegeId,
          dept_id: deptId,
          student_id: metering.studentId ?? undefined,
          session_id: metering.sessionId ?? undefined,
          action_type: "rerank",
          service: "cohere",
          model: "rerank-english-v3.0",
          rerank_units: rerankCandidates.length,
          cost_usd: (rerankCandidates.length / 1000) * cohereRate.per_unit_cost,
          billing_month: getBillingMonth(),
          billing_day: getBillingDay(),
          created_at: new Date(),
        });
      }
    } catch (err) {
      console.error("[rag] Cohere rerank failed (chapter-scoped), falling back to BM25 ranking:", err);
    }
  }

  // 4. MMR diversity re-selection down to the adaptive top-K (F-18-B), gated
  // by query mode (F-19-G) — chapter-scoped chat always wants depth within
  // the chapter, never diversity across it, so this is always off.
  const mmrApplied = shouldApplyMMR("chapter_scoped_chat");
  const reranked = mmrApplied
    ? selectWithMMR(cohereReranked, adaptiveTopK, RAG_MMR_LAMBDA)
    : cohereReranked.slice(0, adaptiveTopK);

  const maxScore = reranked[0]?.score ?? 0;

  // 5. Rerank-score threshold gate (F-19-E) — refused band keeps the existing
  // cross-reference fallback UX; hedged band answers but flags the gap.
  const deptThresholds = await resolveDeptThresholds(collegeId, deptId);
  const { band: confidenceBand, answered: chapterAnswered } =
    reranked.length === 0 ? { band: "refused" as const, answered: false } : gateOnRerankScore(maxScore, deptThresholds);

  if (!chapterAnswered) {
    const unscoped = await queryDocUnscoped(collegeId, deptId, docId, queryVector, 3);
    const topPage = unscoped[0]?.metadata?.page_num as number | undefined;

    const suggestion = topPage != null ? findChapterForPage(allChapters, topPage) : null;

    const fallbackMsg = suggestion && suggestion.chapter_index !== chapter.chapter_index
      ? `This topic isn't covered in Chapter ${chapter.chapter_index}. It appears to be in Chapter ${suggestion.chapter_index}: "${suggestion.title}".`
      : `This topic doesn't appear to be covered in Chapter ${chapter.chapter_index}.`;

    yield {
      type: "fallback",
      message: fallbackMsg,
      suggestion_chapter_index: suggestion?.chapter_index,
      suggestion_chapter_title: suggestion?.title,
    };
    yield { type: "done", sources: [], confidence_score: maxScore, answered: false, tokens_used: 0, answer_confidence_band: confidenceBand };
    return;
  }

  const llmMetering = metering
    ? { collegeId, deptId, studentId: metering.studentId, sessionId: metering.sessionId, actionType: "chat_message" as const }
    : undefined;

  yield { type: "status", message: "Writing your answer…" };

  // 6. Build messages + stream, with truncation detection + auto-continuation (F-18-D)
  const systemPrompt = buildChapterSystemPrompt(chapter, mode) + (confidenceBand === "hedged" ? HEDGE_SYSTEM_PROMPT_ADDITION : "");
  const messages = buildChapterContextPrompt(query, reranked, sessionMessages);

  const { tokenStream, getUsage, getStopReason } = await streamChatResponse(systemPrompt, messages, undefined, llmMetering);

  let fullResponse = "";
  for await (const token of tokenStream) {
    const clean = stripMarkdownArtifacts(token);
    fullResponse += clean;
    yield { type: "token", content: clean };
  }

  let tokensUsed = await getUsage();
  const stopReason = await getStopReason();
  const wasTruncated = stopReason === "max_tokens";
  let wasTruncatedAndContinued = false;

  if (wasTruncated) {
    const continuation = await streamChatResponse(
      systemPrompt,
      [
        ...messages,
        { role: "assistant", content: fullResponse },
        { role: "user", content: "Please continue your previous answer from exactly where you left off. Do not repeat anything already said." },
      ],
      undefined,
      llmMetering,
      LLM_CONTINUATION_MAX_TOKENS,
    );

    for await (const token of continuation.tokenStream) {
      const clean = stripMarkdownArtifacts(token);
      fullResponse += clean;
      yield { type: "token", content: clean };
    }
    tokensUsed += await continuation.getUsage();
    wasTruncatedAndContinued = true;
  }

  const sources = await extractSources(collegeId, reranked);

  yield {
    type: "done",
    sources,
    confidence_score: maxScore,
    answered: true,
    tokens_used: tokensUsed,
    answer_confidence_band: confidenceBand,
    retrieval: {
      query_complexity: queryComplexity,
      top_k_used: adaptiveTopK,
      mmr_applied: mmrApplied,
      query_rewritten_text: rewrite.rewritten_query,
      rewrite_applied: rewrite.rewrite_applied,
      resolved_entities: rewrite.resolved_entities,
    },
    rerank: cohereRerankTelemetry,
    truncation: {
      stop_reason: stopReason,
      was_truncated: wasTruncated,
      was_truncated_and_continued: wasTruncatedAndContinued,
    },
  };
}
