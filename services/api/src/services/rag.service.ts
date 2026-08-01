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
  LLM_MODEL_EXAM,
  LLM_CONTINUATION_MAX_TOKENS,
  type SourceCitation,
  type Chapter,
  type ImageAsset,
  type ImageToken,
  type QueryComplexity,
} from "@college-chatbot/shared";
import { embedQuery } from "./embedding.service";
import { queryMultiNamespace, queryImageMultiNamespace, queryChapterScoped, queryDocUnscoped, type PineconeChunk } from "./pinecone.service";
import { streamChatResponse, generateExamQuestions } from "./llm.service";
import { getCachedResponse, setCachedResponse } from "./cache.service";
import { recordCostEvent, getRateTable, getBillingMonth, getBillingDay } from "./metering.service";
import { rewriteQueryForRetrieval } from "./query-rewrite.service";
import { rerankChunks } from "./cohere-rerank.service";
import { getCollegeDb } from "../db/college.db";
import { getImageAssetModel } from "../models/college/image-asset.model";
import { generateFileToken, TOKEN_TTL } from "./file-token.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RAGEvent =
  | { type: "token"; content: string }
  | {
      type: "done";
      sources: SourceCitation[];
      confidence_score: number;
      answered: boolean;
      tokens_used: number;
      images: ImageToken[];
      // F-18-B: retrieval telemetry — undefined for exam/no-answer/cached paths
      retrieval?: {
        retrieved_chunk_ids: string[];
        cited_chunk_ids: string[];
        retrieval_precision: number;
        query_complexity: QueryComplexity;
        top_k_used: number;
        mmr_applied: boolean;
        query_rewritten_text: string;
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

export interface RAGParams {
  query: string;
  collegeId: string;
  /** Cache key discriminator — e.g. "${collegeId}:year${N}" */
  cacheScope: string;
  /** Docs grouped by their actual dept_id for correct Pinecone namespace routing */
  namespacedDocs: Array<{ deptId: string; docIds: string[] }>;
  sessionMessages: Array<{ role: "user" | "assistant"; content: string }>;
  metering?: RAGMeteringContext;
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

// ─── MMR diversity re-selection (F-18-B) ──────────────────────────────────────

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

function buildChatSystemPrompt(chunks: PineconeChunk[]): string {
  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.text}`)
    .join("\n\n");

  return `You are an expert academic tutor helping students deeply understand their course material.

Your goal is to give thorough, exam-ready answers. Follow these rules:
1. Answer ONLY from the context chunks below — never fabricate or guess facts not present in the material.
2. Be comprehensive: explain concepts fully, include definitions, mechanisms, causes, effects, classifications, and clinical/practical significance where applicable.
3. Use structure: headings (##), bullet points, numbered steps, or tables where they aid clarity.
4. Explain the "why" and "how", not just the "what" — build conceptual understanding, not just recall.
5. If the context contains multiple relevant chunks, synthesise them into one coherent answer.
6. End with a short "Key Takeaway" summary in 1–2 sentences.
7. If the information is genuinely not in the context, say so clearly and do not guess.
8. IMPORTANT: This platform automatically surfaces relevant diagrams and images from the course material alongside your text response. Do NOT say you cannot show images — the UI handles image display separately. If diagrams are listed below under "Relevant diagrams", reference them naturally (e.g. "as shown in the diagram above").
9. Structure your answer as: (1) a direct, complete answer to the core question in 3-5 sentences, (2) supporting mechanism/detail if space allows, (3) always end with your source citation even if it means being slightly more concise in section 2. Never end mid-sentence or mid-explanation — if you are running long, prioritise finishing your current thought and citing your source over adding additional detail.

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

function extractSources(chunks: PineconeChunk[]): SourceCitation[] {
  const seen = new Set<string>();
  const sources: SourceCitation[] = [];

  for (const chunk of chunks) {
    const docId = chunk.metadata.doc_id as string | undefined;
    if (!docId || seen.has(docId)) continue;
    seen.add(docId);

    sources.push({
      doc_id: docId,
      filename: (chunk.metadata.original_filename as string) ?? "",
      page: chunk.metadata.section_index != null
        ? (chunk.metadata.section_index as number) + 1
        : undefined,
      subject: chunk.metadata.subject_id as string | undefined,
      chunk_preview: chunk.text.slice(0, 120),
    });
  }

  return sources;
}

// ─── RAG pipeline ────────────────────────────────────────────────────────────

export async function* runRAG(params: RAGParams): AsyncGenerator<RAGEvent> {
  const { query, collegeId, cacheScope, namespacedDocs, sessionMessages, metering } = params;

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

  const embeddingMetering = metering
    ? { collegeId, deptId: metering.deptId, actionType: "query_embedding" as const, studentId: metering.studentId }
    : undefined;

  // Step 1-2: Rewrite query for retrieval (embedding only — original query still
  // drives BM25/LLM/UI), then embed. Also classify complexity for adaptive top-K.
  const queryComplexity = classifyQueryComplexity(query);
  const adaptiveTopK = TOP_K_BY_COMPLEXITY[queryComplexity];
  const rewrittenQuery = await rewriteQueryForRetrieval(
    query,
    metering ? { collegeId, deptId: metering.deptId, studentId: metering.studentId, sessionId: metering.sessionId } : undefined,
  );
  const queryVector = await embedQuery(rewrittenQuery, embeddingMetering);

  // Step 3: Dense retrieval — text and image run as separate parallel queries
  // so image vectors never compete with text for the same topK slots.
  // includeValues=true on the text query so MMR (Step 4) can compute similarity.
  // Pool widened to RAG_PINECONE_TOP_K (F-18-C) — a narrow top-10 meant the
  // reranker could only reorder chunks it was given, never recover a correct
  // chunk that fell outside that initial window.
  const [retrieved, imageChunks] = await Promise.all([
    queryMultiNamespace(collegeId, namespacedDocs, queryVector, RAG_PINECONE_TOP_K, true),
    queryImageMultiNamespace(collegeId, namespacedDocs, queryVector),
  ]);

  // Meter Pinecone reads (two queries per namespace: text + image)
  if (metering && namespacedDocs.length > 0) {
    const namespacesQueried = namespacedDocs.filter((n) => n.docIds.length > 0).length;
    const pineconeRate = await getRateTable("pinecone", "serverless");
    const costUsd = (namespacesQueried * 2 / 1_000_000) * pineconeRate.per_unit_cost;
    recordCostEvent({
      college_id:        collegeId,
      dept_id:           metering.deptId,
      student_id:        metering.studentId ?? undefined,
      session_id:        metering.sessionId ?? undefined,
      action_type:       "pinecone_read",
      service:           "pinecone",
      model:             "serverless",
      vector_read_units: namespacesQueried * 2,
      cost_usd:          costUsd,
      billing_month:     getBillingMonth(),
      billing_day:       getBillingDay(),
      created_at:        new Date(),
    });
  }

  // Step 3a: BM25 hybrid re-rank on text chunks only (images already semantically filtered).
  // Uses the ORIGINAL query — the rewrite is for embedding match quality, not keyword match.
  const hybridRanked = bm25Merge(query, dedupeNearDuplicates(retrieved));

  // Step 3b: Cohere cross-encoder rerank (F-18-C) on a capped candidate pool —
  // reorders by true relevance rather than the BM25/dense blend alone.
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

  // Step 4: MMR diversity re-selection down to the adaptive top-K (F-18-B) —
  // balances relevance against avoiding near-duplicate chunks in the final answer.
  const reranked = selectWithMMR(cohereReranked, adaptiveTopK, RAG_MMR_LAMBDA);
  const mmrApplied = cohereReranked.some((c) => c.values !== undefined);

  // Resolve image matches independently of the text confidence gate below
  const images = await resolveImageTokens(collegeId, imageChunks, metering?.studentId);

  // Step 5: Confidence check
  const maxScore = reranked[0]?.score ?? 0;
  const answered = maxScore >= CONFIDENCE_THRESHOLD;

  if (!answered) {
    // Fallback — no streaming needed
    const fallback =
      "I don't have information about this topic in the uploaded course material. Please consult your instructor or course resources.";
    yield { type: "token", content: fallback };
    yield { type: "done", sources: [], confidence_score: maxScore, answered: false, tokens_used: 0, images: [] };
    return;
  }

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
    const systemPrompt = buildExamSystemPrompt(reranked);
    const userMsg = buildExamUserMessage(query);
    const json = await generateExamQuestions(systemPrompt, userMsg, llmMetering);

    yield { type: "token", content: json };
    yield {
      type: "done",
      sources: extractSources(reranked),
      confidence_score: maxScore,
      answered: true,
      tokens_used: 0,
      images: [],
    };
    return;
  }

  // Step 6: Assemble conversation context (last N turns)
  const historyWindow = sessionMessages.slice(-RAG_CONVERSATION_TURNS);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...historyWindow,
    { role: "user", content: query },
  ];

  // Step 7: Stream response — image captions are added to context so the LLM can
  // reference "as shown in the diagram"; the image itself is never sent to the LLM.
  const systemPrompt = buildChatSystemPrompt(reranked) + buildImageCaptionContext(images);
  const { tokenStream, getUsage, getStopReason } = await streamChatResponse(systemPrompt, messages, undefined, llmMetering);

  let fullResponse = "";
  for await (const token of tokenStream) {
    fullResponse += token;
    yield { type: "token", content: token };
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
      fullResponse += token;
      yield { type: "token", content: token };
    }
    tokensUsed += await continuation.getUsage();
    wasTruncatedAndContinued = true;
  }

  // Step 8: Post-process
  const sources = extractSources(reranked);

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
      query_rewritten_text: rewrittenQuery,
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
const CHAPTER_CONFIDENCE = 0.55;
const SOCRATIC_HINT_AFTER  = Number(process.env.SOCRATIC_HINT_AFTER_EXCHANGES  ?? 3);
const SOCRATIC_REVEAL_AFTER = Number(process.env.SOCRATIC_REVEAL_AFTER_EXCHANGES ?? 5);

export type ChapterRAGEvent =
  | { type: "token"; content: string }
  | {
      type: "done";
      sources: SourceCitation[];
      confidence_score: number;
      answered: boolean;
      tokens_used: number;
      retrieval?: {
        query_complexity: QueryComplexity;
        top_k_used: number;
        mmr_applied: boolean;
        query_rewritten_text: string;
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
  const base = `You are a study assistant helping a student understand Chapter ${chapter.chapter_index}: "${chapter.title}".
Answer ONLY from the provided context chunks, which are excerpts from pages ${chapter.start_page}–${chapter.end_page}.
Always cite the page number at the end of each relevant point: "— Page X".
If the student asks about a topic not covered in these pages, say: "That topic isn't in this chapter."`;

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

  const embeddingMetering = metering
    ? { collegeId, deptId, actionType: "query_embedding" as const, studentId: metering.studentId }
    : undefined;

  // 1. Rewrite + embed query (F-18-B) — rewrite used only for retrieval, BM25/LLM/UI still see the raw query
  const queryComplexity = classifyQueryComplexity(query);
  const adaptiveTopK = TOP_K_BY_COMPLEXITY[queryComplexity];
  const rewrittenQuery = await rewriteQueryForRetrieval(
    query,
    metering ? { collegeId, deptId, studentId: metering.studentId, sessionId: metering.sessionId } : undefined,
  );
  const queryVector = await embedQuery(rewrittenQuery, embeddingMetering);

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

  // 4. MMR diversity re-selection down to the adaptive top-K (F-18-B)
  const reranked = selectWithMMR(cohereReranked, adaptiveTopK, RAG_MMR_LAMBDA);
  const mmrApplied = cohereReranked.some((c) => c.values !== undefined);

  const maxScore = reranked[0]?.score ?? 0;

  // 5. Low confidence → try cross-reference
  if (reranked.length === 0 || maxScore < CHAPTER_CONFIDENCE) {
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
    yield { type: "done", sources: [], confidence_score: maxScore, answered: false, tokens_used: 0 };
    return;
  }

  const llmMetering = metering
    ? { collegeId, deptId, studentId: metering.studentId, sessionId: metering.sessionId, actionType: "chat_message" as const }
    : undefined;

  // 6. Build messages + stream, with truncation detection + auto-continuation (F-18-D)
  const systemPrompt = buildChapterSystemPrompt(chapter, mode);
  const messages = buildChapterContextPrompt(query, reranked, sessionMessages);

  const { tokenStream, getUsage, getStopReason } = await streamChatResponse(systemPrompt, messages, undefined, llmMetering);

  let fullResponse = "";
  for await (const token of tokenStream) {
    fullResponse += token;
    yield { type: "token", content: token };
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
      fullResponse += token;
      yield { type: "token", content: token };
    }
    tokensUsed += await continuation.getUsage();
    wasTruncatedAndContinued = true;
  }

  const sources = extractSources(reranked);

  yield {
    type: "done",
    sources,
    confidence_score: maxScore,
    answered: true,
    tokens_used: tokensUsed,
    retrieval: {
      query_complexity: queryComplexity,
      top_k_used: adaptiveTopK,
      mmr_applied: mmrApplied,
      query_rewritten_text: rewrittenQuery,
    },
    rerank: cohereRerankTelemetry,
    truncation: {
      stop_reason: stopReason,
      was_truncated: wasTruncated,
      was_truncated_and_continued: wasTruncatedAndContinued,
    },
  };
}
