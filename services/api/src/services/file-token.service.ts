import { randomUUID } from "crypto";
import type { FileType } from "@college-chatbot/shared";
import { getRedisConnection } from "./queue.service";

export type FileTokenIntent = "download" | "preview" | "stream";

export interface FileTokenData {
  file_path: string;    // absolute local path — stored in Redis only, never sent to client
  intent: FileTokenIntent;
  college_id: string;
  dept_id: string;
  student_id: string;
  doc_id: string;
  filename: string;
  mime_type: string;
  single_use: boolean;  // true for download, false for preview/stream
}

const REDIS_KEY_PREFIX = "file_token:";

// TTLs in seconds — env vars with spec defaults
export const TOKEN_TTL = {
  download: Number(process.env.ACCESS_TOKEN_TTL_DOWNLOAD ?? 900),
  preview:  Number(process.env.ACCESS_TOKEN_TTL_PREVIEW  ?? 900),
  stream:   Number(process.env.ACCESS_TOKEN_TTL_STREAM   ?? 7200),
  extraction: Number(process.env.ACCESS_TOKEN_TTL_EXTRACTION ?? 900),
} as const;

const MIME_MAP: Record<FileType, string> = {
  pdf:  "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp4:  "video/mp4",
  mkv:  "video/x-matroska",
  mp3:  "audio/mpeg",
  m4a:  "audio/mp4",
};

export function getMimeType(fileType: FileType): string {
  return MIME_MAP[fileType] ?? "application/octet-stream";
}

export async function generateFileToken(
  data: FileTokenData,
  ttlSeconds: number,
): Promise<string> {
  const token = randomUUID();
  const redis = getRedisConnection();
  await redis.setex(`${REDIS_KEY_PREFIX}${token}`, ttlSeconds, JSON.stringify(data));
  return token;
}

export async function validateFileToken(token: string): Promise<FileTokenData | null> {
  const redis = getRedisConnection();
  const raw = await redis.get(`${REDIS_KEY_PREFIX}${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FileTokenData;
  } catch {
    return null;
  }
}

export async function consumeFileToken(token: string): Promise<void> {
  const redis = getRedisConnection();
  await redis.del(`${REDIS_KEY_PREFIX}${token}`);
}
