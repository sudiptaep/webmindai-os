import { Pinecone } from "@pinecone-database/pinecone";
import { buildPineconeNamespace, EMBEDDING_DIMS, RAG_TOP_K_RETRIEVE } from "@college-chatbot/shared";

export interface PineconeChunk {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

let _client: Pinecone | null = null;

function getClient(): Pinecone {
  if (!_client) _client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _client;
}

function getIndex() {
  return getClient().index(process.env.PINECONE_INDEX_NAME!);
}

export async function queryNamespace(
  collegeId: string,
  deptId: string,
  vector: number[],
  topK: number = RAG_TOP_K_RETRIEVE,
  allowedDocIds?: string[],
): Promise<PineconeChunk[]> {
  if (allowedDocIds !== undefined && allowedDocIds.length === 0) return [];

  const namespace = buildPineconeNamespace(collegeId, deptId);
  const filter = allowedDocIds ? { doc_id: { $in: allowedDocIds } } : undefined;
  const result = await getIndex().namespace(namespace).query({
    vector,
    topK,
    filter,
    includeMetadata: true,
    includeValues: false,
  });

  return (result.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score ?? 0,
    text: (m.metadata?.text as string) ?? "",
    metadata: (m.metadata as Record<string, unknown>) ?? {},
  }));
}

export async function fetchDocChunks(
  collegeId: string,
  deptId: string,
  docId: string,
  topK = 200,
): Promise<Array<{ chunk_index: number; text: string }>> {
  const namespace = buildPineconeNamespace(collegeId, deptId);
  const zero = new Array<number>(EMBEDDING_DIMS).fill(0);
  const result = await getIndex().namespace(namespace).query({
    vector: zero,
    topK,
    filter: { doc_id: { $eq: docId } },
    includeMetadata: true,
    includeValues: false,
  });
  return (result.matches ?? [])
    .map((m) => ({
      chunk_index: (m.metadata?.chunk_index as number) ?? 0,
      text: (m.metadata?.text as string) ?? "",
    }))
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .filter((c) => c.text.length > 0);
}

export async function queryMultiNamespace(
  collegeId: string,
  namespacedDocs: Array<{ deptId: string; docIds: string[] }>,
  vector: number[],
  topK: number = RAG_TOP_K_RETRIEVE,
): Promise<PineconeChunk[]> {
  if (namespacedDocs.length === 0) return [];

  const results = await Promise.all(
    namespacedDocs
      .filter((n) => n.docIds.length > 0)
      .map(({ deptId, docIds }) => queryNamespace(collegeId, deptId, vector, topK, docIds)),
  );

  return results.flat().sort((a, b) => b.score - a.score).slice(0, topK);
}

export async function deleteDocVectors(
  collegeId: string,
  deptId: string,
  docId: string,
): Promise<void> {
  const namespace = buildPineconeNamespace(collegeId, deptId);
  const index = getIndex();

  // Query first to get IDs (works on both serverless and pod indexes)
  const zero = new Array<number>(EMBEDDING_DIMS).fill(0);
  const result = await index.namespace(namespace).query({
    vector: zero,
    topK: 10_000,
    filter: { doc_id: { $eq: docId } },
    includeValues: false,
    includeMetadata: false,
  });

  const ids = (result.matches ?? []).map((m) => m.id);
  if (ids.length === 0) return;

  // Batch-delete in chunks of 1000 (Pinecone limit)
  for (let i = 0; i < ids.length; i += 1000) {
    await index.namespace(namespace).deleteMany(ids.slice(i, i + 1000));
  }
}
