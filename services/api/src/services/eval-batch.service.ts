/**
 * F-19 Step 10: golden-set batch evaluation and before/after reporting.
 *
 * Runs on top of F-18-E's comparison lab — no new retrieval-quality signal
 * needed, everything doc §15.1's metrics table asks for is either already
 * computed per-run (faithfulness/completeness/citation_accuracy/retrieval_hit)
 * or already logged per-query by the F-19 retrieval telemetry (retrieval_tier,
 * parent_expansion_ratio, answer_confidence_band, latency) — this just runs
 * the golden set as a labelled batch and aggregates both sources together.
 *
 * There is no live "old pipeline" to A/B against — F-19 was built as in-place
 * upgrades to the one runRAG, not a parallel v1/v2 branch. The real A/B axis
 * is TIME: run the golden set now (label "baseline"), re-ingest per Step 9,
 * run it again later (label "post-f19"), diff the two labelled batches.
 */
import { getCollegeDb } from "../db/college.db";
import { getGoldenQuestionModel } from "../models/college/golden-question.model";
import { getComparisonRunModel } from "../models/college/comparison-run.model";
import { getQueryLogModel } from "../models/college/query-log.model";
import { runComparison } from "./comparison-lab.service";

export interface BatchRunSummary {
  batch_label: string;
  questions_run: number;
  failed: number;
}

/** Runs every active golden question for a dept (optionally scoped to one subject) as one labelled batch. */
export async function runGoldenSetBatch(
  collegeId: string,
  deptId: string,
  batchLabel: string,
  subjectId?: string,
): Promise<BatchRunSummary> {
  const conn = await getCollegeDb(collegeId);
  const GoldenQuestion = getGoldenQuestionModel(conn);

  const filter: Record<string, unknown> = { dept_id: deptId, active: true };
  if (subjectId) filter.subject_id = subjectId;

  const questions = await GoldenQuestion.find(filter).lean();

  let failed = 0;
  // Sequential, not parallel — each run calls two LLMs (grounded + frontier)
  // plus a judge call; running 200 of those concurrently would hammer rate
  // limits and cost tracking for no benefit (this isn't latency-sensitive).
  for (const q of questions) {
    try {
      await runComparison({
        questionText: q.question_text,
        collegeId,
        deptId,
        subjectId: q.subject_id,
        goldenQuestionId: q._id,
        evalBatchLabel: batchLabel,
      });
    } catch {
      failed++;
    }
  }

  return { batch_label: batchLabel, questions_run: questions.length, failed };
}

export interface BatchMetrics {
  batch_label: string;
  run_count: number;
  // doc §15.1 metrics table
  retrieval_failure_rate: number | null;    // null when no runs had ground truth to check
  faithfulness_score: number;
  answer_completeness: number;
  citation_accuracy_pct: number;
  parent_expansion_ratio: number | null;
  tier1_hit_rate: number | null;
  hedge_rate: number | null;
  p95_latency_ms: number | null;
  window_start: Date | null;
  window_end: Date | null;
}

function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const idx = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, idx)];
}

/** Aggregates a labelled batch's ComparisonRuns plus the matching query_logs window into doc §15.1's metrics table. */
export async function getBatchMetrics(collegeId: string, deptId: string, batchLabel: string): Promise<BatchMetrics> {
  const conn = await getCollegeDb(collegeId);
  const ComparisonRun = getComparisonRunModel(conn);
  const QueryLog = getQueryLogModel(conn);

  const runs = await ComparisonRun.find({ dept_id: deptId, eval_batch_label: batchLabel }).lean();

  if (runs.length === 0) {
    return {
      batch_label: batchLabel, run_count: 0,
      retrieval_failure_rate: null, faithfulness_score: 0, answer_completeness: 0, citation_accuracy_pct: 0,
      parent_expansion_ratio: null, tier1_hit_rate: null, hedge_rate: null, p95_latency_ms: null,
      window_start: null, window_end: null,
    };
  }

  const withGroundTruth = runs.filter((r) => r.retrieval_hit !== undefined);
  const retrievalFailureRate = withGroundTruth.length > 0
    ? withGroundTruth.filter((r) => !r.retrieval_hit).length / withGroundTruth.length
    : null;

  const avgFaithfulness = runs.reduce((s, r) => s + r.faithfulness_score, 0) / runs.length;
  const avgCompleteness = runs.reduce((s, r) => s + r.completeness_score, 0) / runs.length;
  const citationAccuracyPct = runs.filter((r) => r.citation_accuracy).length / runs.length;

  const createdTimes = runs.map((r) => r.created_at.getTime());
  const windowStart = new Date(Math.min(...createdTimes));
  const windowEnd = new Date(Math.max(...createdTimes));

  // Supplementary retrieval telemetry from the same dept + time window this
  // batch ran in — these live on query_logs (student chat traffic), not on
  // ComparisonRun (lab traffic), so they're a window match rather than a
  // per-question join.
  const logsInWindow = await QueryLog.find(
    { dept_id: deptId, created_at: { $gte: windowStart, $lte: windowEnd } },
    { retrieval_tier: 1, parent_expansion_ratio: 1, answer_confidence_band: 1, response_time_ms: 1 },
  ).lean();

  const expansionRatios = logsInWindow.map((l) => l.parent_expansion_ratio).filter((v): v is number => v != null);
  const tiers = logsInWindow.map((l) => l.retrieval_tier).filter((v): v is number => v != null);
  const bands = logsInWindow.map((l) => l.answer_confidence_band).filter((v): v is "confident" | "hedged" | "refused" => v != null);
  const latencies = logsInWindow.map((l) => l.response_time_ms).filter((v): v is number => v != null).sort((a, b) => a - b);

  return {
    batch_label: batchLabel,
    run_count: runs.length,
    retrieval_failure_rate: retrievalFailureRate,
    faithfulness_score: Math.round(avgFaithfulness * 1000) / 1000,
    answer_completeness: Math.round(avgCompleteness * 1000) / 1000,
    citation_accuracy_pct: Math.round(citationAccuracyPct * 1000) / 1000,
    parent_expansion_ratio: expansionRatios.length > 0
      ? Math.round((expansionRatios.reduce((s, v) => s + v, 0) / expansionRatios.length) * 1000) / 1000
      : null,
    tier1_hit_rate: tiers.length > 0
      ? Math.round((tiers.filter((t) => t === 1).length / tiers.length) * 1000) / 1000
      : null,
    hedge_rate: bands.length > 0
      ? Math.round((bands.filter((b) => b === "hedged").length / bands.length) * 1000) / 1000
      : null,
    p95_latency_ms: percentile(latencies, 95),
    window_start: windowStart,
    window_end: windowEnd,
  };
}

export interface BatchComparison {
  baseline: BatchMetrics;
  current: BatchMetrics;
  deltas: {
    retrieval_failure_rate: number | null;
    faithfulness_score: number;
    answer_completeness: number;
    citation_accuracy_pct: number;
    p95_latency_ms: number | null;
  };
  // doc §15.2 step 6 ship gate: faithfulness improves AND p95 latency stays under +500ms
  ship_recommended: boolean | null; // null when either batch lacks data to judge
}

export async function compareBatches(
  collegeId: string,
  deptId: string,
  baselineLabel: string,
  currentLabel: string,
): Promise<BatchComparison> {
  const [baseline, current] = await Promise.all([
    getBatchMetrics(collegeId, deptId, baselineLabel),
    getBatchMetrics(collegeId, deptId, currentLabel),
  ]);

  const bothHaveData = baseline.run_count > 0 && current.run_count > 0;
  const bothHaveLatency = baseline.p95_latency_ms != null && current.p95_latency_ms != null;

  return {
    baseline,
    current,
    deltas: {
      retrieval_failure_rate:
        baseline.retrieval_failure_rate != null && current.retrieval_failure_rate != null
          ? current.retrieval_failure_rate - baseline.retrieval_failure_rate
          : null,
      faithfulness_score: current.faithfulness_score - baseline.faithfulness_score,
      answer_completeness: current.answer_completeness - baseline.answer_completeness,
      citation_accuracy_pct: current.citation_accuracy_pct - baseline.citation_accuracy_pct,
      p95_latency_ms: bothHaveLatency ? current.p95_latency_ms! - baseline.p95_latency_ms! : null,
    },
    ship_recommended: bothHaveData && bothHaveLatency
      ? current.faithfulness_score > baseline.faithfulness_score &&
        (current.p95_latency_ms! - baseline.p95_latency_ms!) < 500
      : null,
  };
}
