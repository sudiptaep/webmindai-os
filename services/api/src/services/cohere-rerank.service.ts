import { CohereClient } from "cohere-ai";

const COHERE_RERANK_MODEL = "rerank-english-v3.0";

let _client: CohereClient | null = null;

function getClient(): CohereClient {
  if (!_client) _client = new CohereClient({ token: process.env.COHERE_API_KEY! });
  return _client;
}

export interface RerankedResult {
  index: number;
  relevanceScore: number;
}

export interface RerankOutcome {
  results: RerankedResult[];
  topScore: number;
  scoreSpread: number; // top score - 5th score (low spread = ambiguous retrieval)
  candidateCount: number;
}

/**
 * F-18-C: real Cohere rerank-english-v3 call. `documents` is the widened
 * candidate pool (post-Pinecone, post-BM25-dedup) — Cohere reorders it,
 * it does not add candidates that weren't already retrieved.
 */
export async function rerankChunks(query: string, documents: string[], topN: number): Promise<RerankOutcome> {
  if (documents.length === 0) {
    return { results: [], topScore: 0, scoreSpread: 0, candidateCount: 0 };
  }

  const response = await getClient().rerank({
    model: COHERE_RERANK_MODEL,
    query,
    documents: documents.map((text) => ({ text })),
    topN,
  });

  const results: RerankedResult[] = response.results.map((r) => ({
    index: r.index,
    relevanceScore: r.relevanceScore,
  }));

  const topScore = results[0]?.relevanceScore ?? 0;
  const fifthScore = results[4]?.relevanceScore ?? 0;

  return {
    results,
    topScore,
    scoreSpread: topScore - fifthScore,
    candidateCount: documents.length,
  };
}
