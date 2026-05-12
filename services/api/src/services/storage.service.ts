import fs from "fs";
import path from "path";
import type { FileType } from "@college-chatbot/shared";

// STORAGE_ROOT takes precedence; UPLOADS_DIR is the legacy name kept for backward compat
export const STORAGE_ROOT = process.env.STORAGE_ROOT ?? process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

// ── Document upload path ────────────────────────────────────────────────────

export function buildDocumentKey(
  collegeId: string,
  deptId: string,
  docId: string,
  filename: string,
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join("colleges", collegeId, deptId, docId, safe);
}

export function resolveLocalPath(key: string): string {
  return path.join(STORAGE_ROOT, key);
}

// ── F-11 derived-path helpers (return absolute paths) ──────────────────────

export function buildThumbnailPath(collegeId: string, docId: string): string {
  return path.join(STORAGE_ROOT, "colleges", collegeId, "thumbnails", `${docId}.jpg`);
}

export function buildTextCachePath(collegeId: string, docId: string): string {
  return path.join(STORAGE_ROOT, "colleges", collegeId, "text_cache", `${docId}.json`);
}

export function buildTranscriptPath(collegeId: string, docId: string): string {
  return path.join(STORAGE_ROOT, "colleges", collegeId, "transcripts", `${docId}.json`);
}

export function buildTempPath(collegeId: string, jobId: string, ext: "pdf" | "pptx" = "pdf"): string {
  return path.join(STORAGE_ROOT, "colleges", collegeId, "temp", `${jobId}.${ext}`);
}

export function getTempDir(collegeId: string): string {
  return path.join(STORAGE_ROOT, "colleges", collegeId, "temp");
}

// ── Core file operations ────────────────────────────────────────────────────

export async function uploadFile(
  key: string,
  body: Buffer,
  _fileType: FileType,
): Promise<void> {
  const fullPath = resolveLocalPath(key);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, body);
}

export async function deleteFile(key: string): Promise<void> {
  const fullPath = resolveLocalPath(key);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    // Remove empty parent dirs up to STORAGE_ROOT
    try {
      let dir = path.dirname(fullPath);
      while (dir !== STORAGE_ROOT) {
        const entries = fs.readdirSync(dir);
        if (entries.length > 0) break;
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      }
    } catch {
      // best-effort cleanup
    }
  }
}

export async function getFileSize(key: string): Promise<number> {
  const fullPath = resolveLocalPath(key);
  return fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
}
