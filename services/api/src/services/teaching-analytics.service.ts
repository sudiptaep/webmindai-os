import type { Connection } from "mongoose";
import { getTeachingSessionModel } from "../models/college/teaching-session.model";
import { getConceptModel } from "../models/college/concept-graph.model";
import { getMisconceptionModel } from "../models/college/misconception.model";

const BACKTRACK_HOTSPOT_THRESHOLD = Number(process.env.TEACHING_BACKTRACK_HOTSPOT_THRESHOLD ?? 0.30);
const MISCONCEPTION_LOW_SUCCESS_ALERT = Number(process.env.MISCONCEPTION_LOW_SUCCESS_ALERT ?? 0.60);
const MIN_SESSIONS_FOR_HOTSPOT = Number(process.env.TEACHING_MIN_SESSIONS_FOR_HOTSPOT ?? 5);

export interface MostTaughtRow {
  concept_id: string;
  canonical_name: string;
  sessions: number;
  avg_checks: number;
  backtrack_rate: number;
}

export interface BacktrackPair {
  conceptId: string;
  prerequisiteId: string;
  count: number;
}

export interface BacktrackHotspot {
  concept_id: string;
  prerequisite_id: string;
  rate: number;
  count: number;
  sessions: number;
}

/**
 * Pure — given each concept's total (non-nested) session count and the raw
 * (concept, prerequisite) backtrack pair counts, picks the single most
 * common prerequisite gap per concept and flags it as a hotspot when its
 * rate clears the threshold and there's enough volume to trust the rate.
 */
export function computeBacktrackHotspots(
  sessionCounts: Map<string, number>,
  pairs: BacktrackPair[],
  threshold = BACKTRACK_HOTSPOT_THRESHOLD,
  minSessions = MIN_SESSIONS_FOR_HOTSPOT,
): BacktrackHotspot[] {
  const byConceptBest = new Map<string, BacktrackPair>();
  for (const pair of pairs) {
    const existing = byConceptBest.get(pair.conceptId);
    if (!existing || pair.count > existing.count) byConceptBest.set(pair.conceptId, pair);
  }

  const hotspots: BacktrackHotspot[] = [];
  for (const [conceptId, best] of byConceptBest) {
    const sessions = sessionCounts.get(conceptId) ?? 0;
    if (sessions < minSessions) continue;
    const rate = best.count / sessions;
    if (rate >= threshold) {
      hotspots.push({ concept_id: conceptId, prerequisite_id: best.prerequisiteId, rate, count: best.count, sessions });
    }
  }

  return hotspots.sort((a, b) => b.rate - a.rate);
}

export async function getMostTaughtConcepts(conn: Connection, deptId: string, days: number): Promise<MostTaughtRow[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const TeachingSession = getTeachingSessionModel(conn);
  const Concept = getConceptModel(conn);

  const rows = await TeachingSession.aggregate([
    { $match: { dept_id: deptId, is_nested: false, started_at: { $gte: since } } },
    {
      $group: {
        _id: "$concept_id",
        sessions: { $sum: 1 },
        avg_checks: { $avg: "$total_checks" },
        backtracked: { $sum: { $cond: [{ $gt: ["$backtracks_triggered", 0] }, 1, 0] } },
      },
    },
    { $sort: { sessions: -1 } },
    { $limit: 20 },
  ]);

  if (rows.length === 0) return [];
  const concepts = await Concept.find({ _id: { $in: rows.map((r) => r._id) } }).select("canonical_name").lean();
  const nameById = new Map(concepts.map((c) => [c._id, c.canonical_name]));

  return rows.map((r) => ({
    concept_id: r._id,
    canonical_name: nameById.get(r._id) ?? r._id,
    sessions: r.sessions,
    avg_checks: Math.round((r.avg_checks ?? 0) * 10) / 10,
    backtrack_rate: r.sessions > 0 ? r.backtracked / r.sessions : 0,
  }));
}

async function getSessionCountsAndBacktrackPairs(
  conn: Connection,
  deptId: string,
  since: Date,
): Promise<{ sessionCounts: Map<string, number>; pairs: BacktrackPair[] }> {
  const TeachingSession = getTeachingSessionModel(conn);

  const [countRows, pairRows] = await Promise.all([
    TeachingSession.aggregate([
      { $match: { dept_id: deptId, is_nested: false, started_at: { $gte: since } } },
      { $group: { _id: "$concept_id", sessions: { $sum: 1 } } },
    ]),
    TeachingSession.aggregate([
      { $match: { dept_id: deptId, is_nested: false, started_at: { $gte: since }, "backtrack_stack.0": { $exists: true } } },
      { $unwind: "$backtrack_stack" },
      { $group: { _id: { concept: "$concept_id", prereq: "$backtrack_stack.prerequisite_concept_id" }, count: { $sum: 1 } } },
    ]),
  ]);

  return {
    sessionCounts: new Map(countRows.map((r) => [r._id as string, r.sessions as number])),
    pairs: pairRows.map((r) => ({ conceptId: r._id.concept, prerequisiteId: r._id.prereq, count: r.count })),
  };
}

export async function getBacktrackHotspots(conn: Connection, deptId: string, days: number): Promise<Array<BacktrackHotspot & { concept_name: string; prerequisite_name: string }>> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const { sessionCounts, pairs } = await getSessionCountsAndBacktrackPairs(conn, deptId, since);
  const hotspots = computeBacktrackHotspots(sessionCounts, pairs);
  if (hotspots.length === 0) return [];

  const Concept = getConceptModel(conn);
  const ids = [...new Set(hotspots.flatMap((h) => [h.concept_id, h.prerequisite_id]))];
  const concepts = await Concept.find({ _id: { $in: ids } }).select("canonical_name").lean();
  const nameById = new Map(concepts.map((c) => [c._id, c.canonical_name]));

  return hotspots.map((h) => ({
    ...h,
    concept_name: nameById.get(h.concept_id) ?? h.concept_id,
    prerequisite_name: nameById.get(h.prerequisite_id) ?? h.prerequisite_id,
  }));
}

export async function getMisconceptionFrequency(conn: Connection, deptId: string) {
  const Misconception = getMisconceptionModel(conn);
  return Misconception.find({ dept_id: deptId, observed_count: { $gt: 0 } })
    .sort({ observed_count: -1 })
    .limit(20)
    .select("concept_id statement observed_count times_probed times_corrected correction_success_rate")
    .lean();
}

export async function getTeachingAnalytics(conn: Connection, deptId: string, days: number) {
  const [mostTaught, hotspots, misconceptions] = await Promise.all([
    getMostTaughtConcepts(conn, deptId, days),
    getBacktrackHotspots(conn, deptId, days),
    getMisconceptionFrequency(conn, deptId),
  ]);

  const totalSessions = mostTaught.reduce((sum, r) => sum + r.sessions, 0);
  const weightedChecks = mostTaught.reduce((sum, r) => sum + r.avg_checks * r.sessions, 0);

  return {
    most_taught_concepts: mostTaught,
    backtrack_hotspots: hotspots,
    misconception_frequency: misconceptions,
    avg_checks_to_mastery: totalSessions > 0 ? Math.round((weightedChecks / totalSessions) * 10) / 10 : 0,
  };
}

export async function getStruggleReport(conn: Connection, deptId: string, days: number) {
  const [hotspots, misconceptions] = await Promise.all([
    getBacktrackHotspots(conn, deptId, days),
    getMisconceptionFrequency(conn, deptId),
  ]);

  return {
    concepts_with_high_backtrack: hotspots.map((h) => ({
      concept_id: h.concept_id,
      canonical_name: h.concept_name,
      backtrack_rate: h.rate,
      sessions: h.sessions,
      most_common_gap: h.prerequisite_name,
      recommendation: `${Math.round(h.rate * 100)}% of students teaching themselves "${h.concept_name}" required a prerequisite back-track — most commonly to "${h.prerequisite_name}". Consider covering that explicitly before this topic.`,
    })),
    low_correction_misconceptions: misconceptions
      .filter((m) => m.times_probed >= 3 && (m.correction_success_rate ?? 1) < MISCONCEPTION_LOW_SUCCESS_ALERT)
      .map((m) => ({
        misconception_id: m._id,
        concept_id: m.concept_id,
        statement: m.statement,
        correction_success_rate: m.correction_success_rate,
        times_probed: m.times_probed,
        recommendation: `Only corrected ${Math.round((m.correction_success_rate ?? 0) * 100)}% of the time (${m.times_probed} probes) — the correction wording may need revision.`,
      })),
  };
}
