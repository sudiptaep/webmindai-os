/**
 * F-19-F: Reciprocal Rank Fusion. Combines multiple ranked lists without
 * needing score normalisation — it uses only RANK position, which sidesteps
 * the problem that cosine/dot-product scores and BM25 scores live on
 * incomparable scales.
 *
 * RRF score for a document d = Σ over lists L of 1 / (k + rank_L(d))
 * k=60 is the standard constant from the original RRF paper.
 */
export function reciprocalRankFusion<T extends { id: string }>(
  rankedLists: T[][],
  k = 60,
): Array<T & { rrf_score: number }> {
  const scores = new Map<string, number>();
  const docs = new Map<string, T>();

  for (const list of rankedLists) {
    list.forEach((doc, rank) => {
      const contribution = 1 / (k + rank + 1); // rank is 0-indexed
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + contribution);
      if (!docs.has(doc.id)) docs.set(doc.id, doc);
    });
  }

  return Array.from(scores.entries())
    .map(([id, rrf_score]) => ({ ...(docs.get(id) as T), id, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score);
}
