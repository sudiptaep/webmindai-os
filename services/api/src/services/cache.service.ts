import { getRedisConnection } from "./queue.service";
import crypto from "crypto";

const TTL_SECONDS = 24 * 60 * 60; // 24h

function buildCacheKey(query: string, deptId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${query.trim().toLowerCase()}::${deptId}`)
    .digest("hex");
  return `rag_cache:${hash}`;
}

export interface CachedRagResponse {
  tokens: string;
  sources: unknown[];
  confidence_score: number;
  answered: boolean;
}

export async function getCachedResponse(
  query: string,
  deptId: string
): Promise<CachedRagResponse | null> {
  const redis = getRedisConnection();
  const key = buildCacheKey(query, deptId);
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedRagResponse;
  } catch {
    return null;
  }
}

export async function setCachedResponse(
  query: string,
  deptId: string,
  response: CachedRagResponse
): Promise<void> {
  const redis = getRedisConnection();
  const key = buildCacheKey(query, deptId);
  await redis.setex(key, TTL_SECONDS, JSON.stringify(response));
}
