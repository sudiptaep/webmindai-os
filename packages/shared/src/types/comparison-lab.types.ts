// F-18-E: Frontier Model Comparison Lab

export type GoldenQuestionDifficulty = "recall" | "application" | "analysis";

export interface GoldenQuestion {
  _id: string;
  college_id: string;
  dept_id: string;
  subject_id?: string;
  question_text: string;
  expected_source_doc_id?: string;
  expected_source_page?: number;
  expected_answer_summary?: string;
  difficulty: GoldenQuestionDifficulty;
  added_by: string;
  active: boolean;
  created_at: Date;
}

export type ComparisonFailureSignature =
  | "none"
  | "extraction_failure"
  | "retrieval_failure"
  | "expected_divergence";

export type ComparisonHumanVerdict = "grounded_better" | "frontier_better" | "equivalent" | "both_wrong";

export interface ComparisonRunSource {
  doc_id: string;
  page?: number;
  chunk_text: string;
}

export interface ComparisonRun {
  _id: string;
  golden_question_id?: string;
  question_text: string;
  dept_id: string;
  college_id: string;
  // F-19 Step 10: tags a run as part of a named batch (e.g. "baseline-2026-05",
  // "post-f19-2026-08") so the same golden question set run at two points in
  // time can be diffed into a before/after report.
  eval_batch_label?: string;
  // Ground truth check against the golden question's expected_source_doc_id/
  // page — undefined when the golden question has no ground truth set,
  // otherwise true/false. This IS doc §15.1's "retrieval failure rate" signal;
  // faithfulness_score/citation_accuracy below are judge opinions, not this.
  retrieval_hit?: boolean;

  grounded_response_text: string;
  grounded_sources: ComparisonRunSource[];
  grounded_retrieval_score: number;
  grounded_latency_ms: number;
  grounded_tokens_used: number;

  frontier_model: string;
  frontier_response_text: string;
  frontier_latency_ms: number;
  frontier_tokens_used: number;

  faithfulness_score: number;
  completeness_score: number;
  citation_accuracy: boolean;
  judge_reasoning: string;

  human_verdict?: ComparisonHumanVerdict;
  human_notes?: string;
  reviewed_by?: string;
  reviewed_at?: Date;

  failure_signature: ComparisonFailureSignature;

  created_at: Date;
}
