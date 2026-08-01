/**
 * Migration 017: F-18-A quality re-score (formula v2)
 *
 * Re-runs the new multi-signal quality formula against already-ingested
 * documents using the cached text_cache_path JSON (page text + per-page
 * ocr_confidence) — no re-embedding, no re-ingestion.
 *
 * Docs ingested before F-18-A shipped have `ocr_confidence: null` for every
 * page in their cache (the field existed but was never populated), so their
 * ocr_confidence signal can't be reconstructed — those are flagged
 * `quality_rescoring_needed: true` instead of silently guessing.
 *
 * Run: node infra/migrations/017-rescore-quality-v2.js
 */

const { MongoClient } = require("mongodb");
const fs = require("fs");

const MONGO_PLATFORM_URI = process.env.MONGO_PLATFORM_URI;
const MONGO_BASE_URI = process.env.MONGO_BASE_URI;

if (!MONGO_PLATFORM_URI || !MONGO_BASE_URI) {
  console.error("MONGO_PLATFORM_URI and MONGO_BASE_URI must be set");
  process.exit(1);
}

const WEIGHTS = {
  density: 0.15,
  ocr_confidence: 0.30,
  structural_integrity: 0.25,
  vocab_validity: 0.20,
  boilerplate_penalty: 0.10,
};

const WORD_RE = /[A-Za-z]{2,}|\d+/g;
const VALID_WORD_RE = /^[A-Za-z]+$/;

function computeValidWordRatio(text) {
  const tokens = text.match(WORD_RE) ?? [];
  if (tokens.length === 0) return 1.0;
  const valid = tokens.filter((t) => VALID_WORD_RE.test(t) || /^\d+$/.test(t)).length;
  return Math.round((valid / tokens.length) * 10000) / 10000;
}

function computeBoilerplateRatio(pageTexts) {
  if (pageTexts.length < 3) return 0;
  const lineCounts = new Map();
  const perPageLines = pageTexts.map((t) => t.split("\n"));

  for (const lines of perPageLines) {
    const seen = new Set();
    for (const line of lines) {
      const normalized = line.trim().toLowerCase();
      if (!normalized || normalized.length > 80 || seen.has(normalized)) continue;
      seen.add(normalized);
      lineCounts.set(normalized, (lineCounts.get(normalized) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.floor(pageTexts.length * 0.3));
  const boilerplateLines = new Set([...lineCounts.entries()].filter(([, c]) => c >= threshold).map(([l]) => l));
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

function getCollegeDbName(collegeId) {
  return `cc_${collegeId.replace(/-/g, "").slice(0, 24)}`;
}

async function rescoreDoc(doc) {
  // Already ingested by the new v2 pipeline — its quality_score is already the
  // real per-page-confidence-derived score. Re-running this migration against
  // it would overwrite that with the cache-based rescore's structural_integrity
  // fallback (always 1.0, since hyphenation-repair count isn't recoverable from
  // cached plain text), silently downgrading a more accurate original score.
  if (doc.extraction_artifacts_cached && doc.quality_formula_version === 2) {
    return { status: "already_v2" };
  }
  if (!doc.text_cache_path || !fs.existsSync(doc.text_cache_path)) {
    return { status: "flagged", reason: "no_cached_text" };
  }

  const cache = JSON.parse(fs.readFileSync(doc.text_cache_path, "utf-8"));
  const pages = cache.pages ?? [];
  if (pages.length === 0) return { status: "flagged", reason: "empty_cache" };

  const pageTexts = pages.map((p) => p.text ?? "");
  const avgCharsPerPage = pageTexts.reduce((s, t) => s + t.length, 0) / pageTexts.length;

  let ocrConfidence = 1.0;
  if (doc.ocr_used) {
    const confidences = pages.map((p) => p.ocr_confidence).filter((c) => c != null);
    if (confidences.length === 0) {
      // Legacy cache never recorded real per-word confidence — can't reconstruct this signal.
      return { status: "flagged", reason: "no_ocr_confidence_cached" };
    }
    ocrConfidence = confidences.reduce((s, c) => s + c, 0) / confidences.length / 100.0;
  }

  const signals = {
    density: Math.round(Math.min(avgCharsPerPage / 500, 1.0) * 1000) / 1000,
    ocr_confidence: Math.round(ocrConfidence * 1000) / 1000,
    // Hyphenation-repair count isn't retroactively knowable from cached plain
    // text alone, so structural_integrity defaults to "no signal detected" (1.0)
    // for legacy re-scores rather than guessing.
    structural_integrity: 1.0,
    vocab_validity: computeValidWordRatio(pageTexts.join("\n")),
    boilerplate_penalty: Math.round((1.0 - computeBoilerplateRatio(pageTexts)) * 1000) / 1000,
  };

  const qualityScore = Math.round(
    Object.keys(WEIGHTS).reduce((sum, k) => sum + signals[k] * WEIGHTS[k], 0) * 1000,
  ) / 1000;

  return {
    status: "rescored",
    quality_score: qualityScore,
    signal_breakdown: signals,
  };
}

async function migrate() {
  const platformClient = new MongoClient(MONGO_PLATFORM_URI);
  await platformClient.connect();
  const platformDb = platformClient.db("platform");
  const colleges = await platformDb.collection("colleges").find({ status: "active" }).toArray();

  console.log(`Found ${colleges.length} active colleges to re-score`);
  let rescored = 0;
  let flagged = 0;
  let skipped = 0;

  for (const college of colleges) {
    const collegeId = String(college._id);
    const dbName = getCollegeDbName(collegeId);
    const client = new MongoClient(`${MONGO_BASE_URI}/${dbName}`);
    await client.connect();
    const db = client.db(dbName);

    const docs = await db.collection("documents").find({ ingestion_status: "completed" }).toArray();

    for (const doc of docs) {
      const result = await rescoreDoc(doc);
      if (result.status === "rescored") {
        await db.collection("documents").updateOne(
          { _id: doc._id },
          {
            $set: {
              quality_score: result.quality_score,
              signal_breakdown: result.signal_breakdown,
              quality_formula_version: 2,
              quality_rescoring_needed: false,
            },
          },
        );
        rescored++;
      } else if (result.status === "flagged") {
        await db.collection("documents").updateOne(
          { _id: doc._id },
          { $set: { quality_rescoring_needed: true } },
        );
        console.log(`  [FLAGGED] ${doc.original_filename} (${collegeId}) — ${result.reason}`);
        flagged++;
      } else {
        skipped++;
      }
    }

    await client.close();
  }

  await platformClient.close();
  console.log(`\nDone. Rescored: ${rescored}, Flagged for re-ingestion: ${flagged}, Skipped (already v2): ${skipped}`);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
