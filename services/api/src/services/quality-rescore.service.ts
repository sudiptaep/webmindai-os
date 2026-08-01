import fs from "fs/promises";
import type { QualitySignalBreakdown } from "@college-chatbot/shared";

// F-18-A: mirrors services/ingestion-worker/quality/compute_quality_score.py's
// signal weights — kept in sync manually since the two services don't share a
// Python/TS runtime.
const WEIGHTS: Record<keyof QualitySignalBreakdown, number> = {
  density: 0.15,
  ocr_confidence: 0.30,
  structural_integrity: 0.25,
  vocab_validity: 0.20,
  boilerplate_penalty: 0.10,
};

interface CachedPage {
  page_num: number;
  text: string;
  ocr_confidence: number | null;
}

interface TextCache {
  total_pages: number;
  pages: CachedPage[];
}

export type RescoreResult =
  | { status: "rescored"; quality_score: number; signal_breakdown: QualitySignalBreakdown }
  | { status: "flagged"; reason: "no_cached_text" | "empty_cache" | "no_ocr_confidence_cached" };

function computeValidWordRatio(text: string): number {
  const tokens = text.match(/[A-Za-z]{2,}|\d+/g) ?? [];
  if (tokens.length === 0) return 1.0;
  const valid = tokens.filter((t) => /^[A-Za-z]+$/.test(t) || /^\d+$/.test(t)).length;
  return Math.round((valid / tokens.length) * 10000) / 10000;
}

function computeBoilerplateRatio(pageTexts: string[]): number {
  if (pageTexts.length < 3) return 0;
  const lineCounts = new Map<string, number>();
  const perPageLines = pageTexts.map((t) => t.split("\n"));

  for (const lines of perPageLines) {
    const seen = new Set<string>();
    for (const line of lines) {
      const normalized = line.trim().toLowerCase();
      if (!normalized || normalized.length > 80 || seen.has(normalized)) continue;
      seen.add(normalized);
      lineCounts.set(normalized, (lineCounts.get(normalized) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.floor(pageTexts.length * 0.3));
  const boilerplateLines = new Set(
    [...lineCounts.entries()].filter(([, c]) => c >= threshold).map(([l]) => l),
  );
  if (boilerplateLines.size === 0) return 0;

  const totalChars = pageTexts.reduce((s, t) => s + t.length, 0) || 1;
  let stripped = 0;
  for (const lines of perPageLines) {
    for (const line of lines) {
      if (boilerplateLines.has(line.trim().toLowerCase())) stripped += line.length;
    }
  }
  return Math.round((stripped / totalChars) * 10000) / 10000;
}

/**
 * Re-runs the F-18-A multi-signal quality formula against a document's cached
 * text (text_cache_path) without re-ingesting or re-embedding.
 *
 * structural_integrity defaults to 1.0 here — the hyphenation-repair count
 * that formula normally derives from isn't retroactively knowable once only
 * the cleaned plain text is cached.
 */
export async function rescoreFromTextCache(params: {
  textCachePath: string | undefined;
  ocrUsed: boolean;
}): Promise<RescoreResult> {
  if (!params.textCachePath) return { status: "flagged", reason: "no_cached_text" };

  let cache: TextCache;
  try {
    cache = JSON.parse(await fs.readFile(params.textCachePath, "utf-8"));
  } catch {
    return { status: "flagged", reason: "no_cached_text" };
  }

  const pages = cache.pages ?? [];
  if (pages.length === 0) return { status: "flagged", reason: "empty_cache" };

  const pageTexts = pages.map((p) => p.text ?? "");
  const avgCharsPerPage = pageTexts.reduce((s, t) => s + t.length, 0) / pageTexts.length;

  let ocrConfidence = 1.0;
  if (params.ocrUsed) {
    const confidences = pages.map((p) => p.ocr_confidence).filter((c): c is number => c != null);
    if (confidences.length === 0) {
      return { status: "flagged", reason: "no_ocr_confidence_cached" };
    }
    ocrConfidence = confidences.reduce((s, c) => s + c, 0) / confidences.length / 100.0;
  }

  const signals: QualitySignalBreakdown = {
    density: Math.round(Math.min(avgCharsPerPage / 500, 1.0) * 1000) / 1000,
    ocr_confidence: Math.round(ocrConfidence * 1000) / 1000,
    structural_integrity: 1.0,
    vocab_validity: computeValidWordRatio(pageTexts.join("\n")),
    boilerplate_penalty: Math.round((1.0 - computeBoilerplateRatio(pageTexts)) * 1000) / 1000,
  };

  const qualityScore =
    Math.round(
      (Object.keys(WEIGHTS) as Array<keyof QualitySignalBreakdown>).reduce(
        (sum, k) => sum + signals[k] * WEIGHTS[k],
        0,
      ) * 1000,
    ) / 1000;

  return { status: "rescored", quality_score: qualityScore, signal_breakdown: signals };
}
