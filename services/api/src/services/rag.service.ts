import {
  CONFIDENCE_THRESHOLD,
  RAG_TOP_K_RETRIEVE,
  RAG_TOP_K_RERANK,
  RAG_CONVERSATION_TURNS,
  LLM_MODEL_EXAM,
  type SourceCitation,
} from "@college-chatbot/shared";
import { embedQuery } from "./embedding.service";
import { queryMultiNamespace, type PineconeChunk } from "./pinecone.service";
import { streamChatResponse, generateExamQuestions } from "./llm.service";
import { getCachedResponse, setCachedResponse } from "./cache.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RAGEvent =
  | { type: "token"; content: string }
  | { type: "done"; sources: SourceCitation[]; confidence_score: number; answered: boolean; tokens_used: number };

export interface RAGParams {
  query: string;
  collegeId: string;
  /** Cache key discriminator — e.g. "${collegeId}:year${N}" */
  cacheScope: string;
  /** Docs grouped by their actual dept_id for correct Pinecone namespace routing */
  namespacedDocs: Array<{ deptId: string; docIds: string[] }>;
  sessionMessages: Array<{ role: "user" | "assistant"; content: string }>;
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
  const { query, collegeId, cacheScope, namespacedDocs, sessionMessages } = params;

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
      };
      return;
    }
  }

  // Step 1-2: Embed query
  const queryVector = await embedQuery(query);

  // Step 3: Dense retrieval across all dept namespaces that hold the allowed docs
  const retrieved = await queryMultiNamespace(
    collegeId,
    namespacedDocs,
    queryVector,
    RAG_TOP_K_RETRIEVE,
  );

  // Step 3b: BM25 hybrid re-rank (in-memory, no extra API call)
  const hybridRanked = bm25Merge(query, retrieved);

  // Step 4: Take top-K from BM25 hybrid ranking (no external reranker needed)
  const reranked = hybridRanked.slice(0, RAG_TOP_K_RERANK);

  // Step 5: Confidence check
  const maxScore = reranked[0]?.score ?? 0;
  const answered = maxScore >= CONFIDENCE_THRESHOLD;

  if (!answered) {
    // Fallback — no streaming needed
    const fallback =
      "I don't have information about this topic in the uploaded course material. Please consult your instructor or course resources.";
    yield { type: "token", content: fallback };
    yield { type: "done", sources: [], confidence_score: maxScore, answered: false, tokens_used: 0 };
    return;
  }

  // Exam mode — non-streaming structured JSON response
  if (isExamRequest(query)) {
    const systemPrompt = buildExamSystemPrompt(reranked);
    const userMsg = buildExamUserMessage(query);
    const json = await generateExamQuestions(systemPrompt, userMsg);

    yield { type: "token", content: json };
    yield {
      type: "done",
      sources: extractSources(reranked),
      confidence_score: maxScore,
      answered: true,
      tokens_used: 0,
    };
    return;
  }

  // Step 6: Assemble conversation context (last N turns)
  const historyWindow = sessionMessages.slice(-RAG_CONVERSATION_TURNS);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...historyWindow,
    { role: "user", content: query },
  ];

  // Step 7: Stream response
  const systemPrompt = buildChatSystemPrompt(reranked);
  const { tokenStream, getUsage } = await streamChatResponse(systemPrompt, messages);

  let fullResponse = "";
  for await (const token of tokenStream) {
    fullResponse += token;
    yield { type: "token", content: token };
  }

  // Step 8: Post-process
  const tokensUsed = await getUsage();
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
  };
}
