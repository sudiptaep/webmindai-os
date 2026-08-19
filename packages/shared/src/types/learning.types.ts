// ── F-14: Learning Intelligence Layer ────────────────────────────────────────

import type { QuizQuestionType } from "./document.types";

export type SrsCardStatus = "active" | "suspended" | "graduated";
export type CaseQuestionType = "diagnosis" | "management" | "investigation" | "mechanism" | "complication";
export type CaseDifficulty = "recall" | "application" | "analysis";

// ─── Spaced Repetition ────────────────────────────────────────────────────────

export interface SrsCard {
  _id: string;
  student_id: string;
  college_id: string;
  dept_id: string;
  doc_id: string;
  chapter_index: number;
  subject_id: string;

  question_text: string;
  question_type: QuizQuestionType;
  options: string[];
  correct_answer: string;
  explanation: string;
  source_page?: number;
  bloom_level: string;

  // SM-2 state
  ease_factor: number;        // 1.3–3.0, default 2.5
  interval_days: number;
  repetition_count: number;
  last_quality: number;       // 0–5

  next_review_at: Date;
  first_seen_at: Date;
  last_reviewed_at: Date;

  status: SrsCardStatus;
  // F-20-C §10.4: teaching-session hand-off provenance — undefined for
  // pre-existing origins (quiz correct-answer capture, manual add).
  origin?: "teaching_session" | "teaching_session_misconception";
  origin_session_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface SrsReviewLog {
  _id: string;
  srs_card_id: string;
  student_id: string;
  college_id: string;

  quality: number;            // 0–5
  student_answer: string;
  was_correct: boolean;
  time_taken_seconds: number;

  interval_before: number;
  ease_before: number;
  interval_after: number;
  ease_after: number;
  next_review_at: Date;

  reviewed_at: Date;
}

// ─── Clinical Cases ───────────────────────────────────────────────────────────

export interface ClinicalCase {
  _id: string;
  college_id: string;
  dept_id: string;
  doc_id: string;
  chapter_index: number;
  subject_id: string;

  case_text: string;
  question: string;
  question_type: CaseQuestionType;
  difficulty: CaseDifficulty;
  options: string[];
  correct_answer: string;
  expected_answer: string;
  key_teaching_points: string[];
  source_pages: number[];
  bloom_level: string;

  generated_from_chunk_ids: string[];
  cache_version: number;
  times_served: number;

  created_at: Date;
  expires_at?: Date;
}

// ─── Disease Query ────────────────────────────────────────────────────────────

export interface DiseaseChunkResult {
  chunk_id: string;
  text: string;
  page_num: number;
  chapter_title: string;
  relevance_score: number;
}

export interface DiseaseSubjectResult {
  subject_id: string;
  subject_name: string;
  doc_id: string;
  doc_filename: string;
  relevant_chunks: DiseaseChunkResult[];
  summary: string;
}

export interface DiseaseQuery {
  _id: string;
  college_id: string;
  dept_id_scope: string;          // "all" or specific dept_id
  disease_name: string;           // normalised: "myocardial_infarction"
  disease_aliases: string[];

  subject_results: DiseaseSubjectResult[];
  compiled_answer: string;
  cross_connections: string[];

  cache_key: string;              // MD5(college_id + disease_name)
  created_at: Date;
  expires_at: Date;               // 24h TTL
}

// ── F-20: Adaptive Teaching Engine ───────────────────────────────────────────

export type ConceptType =
  | "process_mechanism"
  | "structure_anatomy"
  | "law_relationship"
  | "classification"
  | "procedure_calculation"
  | "causal_chain"
  | "definition";

export type BloomLevel = "remember" | "understand" | "apply" | "analyse";

export type ConceptExtractionMethod = "llm_chapter_pass" | "faculty_authored" | "faculty_edited";

// ─── F-20-A: Concept Graph ──────────────────────────────────────────────────

export interface Concept {
  _id: string;
  college_id: string;
  dept_id: string;
  subject_id?: string;
  doc_id: string;

  canonical_name: string;
  aliases: string[];
  concept_type: ConceptType;
  one_line_definition: string;

  chapter_index: number;
  source_pages: number[];

  prerequisite_ids: string[];
  prerequisite_names: string[];       // denormalised for display

  bloom_ceiling: BloomLevel;
  difficulty_rating: number;          // 0-1
  is_examinable: boolean;
  pyq_frequency: number;              // populated from F-13-E

  extraction_method: ConceptExtractionMethod;
  reviewed_by_faculty: boolean;
  concept_graph_version: number;

  created_at: Date;
  updated_at: Date;
}

// ─── F-20-B: Misconception Library ─────────────────────────────────────────

export type MisconceptionSource = "llm_seeded" | "observed_from_students" | "seeded_and_observed" | "faculty_authored";

export interface Misconception {
  _id: string;
  concept_id: string;
  college_id: string;
  dept_id: string;

  statement: string;
  correct_model: string;
  root_cause: string;
  diagnostic_probe: string;
  probe_correct_answer: string;
  probe_wrong_answer: string;

  source: MisconceptionSource;
  observed_count: number;
  first_observed: Date;
  last_observed: Date;

  times_probed: number;
  times_corrected: number;
  correction_success_rate: number | null;   // recomputed nightly

  reviewed_by_faculty: boolean;
  priority_rank: number;               // which to probe first if several exist

  created_at: Date;
  updated_at: Date;
}

// ─── F-20-E: Adaptive Difficulty & Learner Model ───────────────────────────

export type ExplanationStrategy =
  | "analogy"
  | "first_principles"
  | "worked_example"
  | "contrast_pair"
  | "concrete_instance"
  | "visual_spatial"
  | "extreme_case"
  | "error_analysis"
  | "narrative_history"
  | "mnemonic";

export interface ConceptMastery {
  confidence: number;              // 0-1, EWMA over check outcomes
  checks_passed: number;
  checks_failed: number;
  last_taught_at?: Date;
  last_confirmed_at?: Date;
  highest_level_passed: number;    // deepest difficulty rung they succeeded at
  sessions_count: number;
}

export interface HeldMisconception {
  misconception_id: string;
  concept_id: string;
  first_observed: Date;
  last_observed: Date;
  times_observed: number;
  corrected: boolean;              // true once they pass the post-correction check
  corrected_at?: Date;
}

export interface LearnerModel {
  _id: string;
  student_id: string;
  college_id: string;
  dept_id: string;

  concept_mastery: Record<string, ConceptMastery>;
  held_misconceptions: HeldMisconception[];

  strategy_success_rates: Partial<Record<ExplanationStrategy, number>>;
  strategy_sample_counts: Partial<Record<ExplanationStrategy, number>>;

  avg_checks_to_mastery: number;
  avg_session_duration_minutes: number;
  preferred_difficulty_entry_level: number;

  total_teaching_sessions: number;
  total_concepts_taught: number;
  total_backtracks_triggered: number;

  updated_at: Date;
}

// ─── F-20-F: Faculty Teaching Profile ──────────────────────────────────────

export type AnalogyPolicy = "sparing" | "liberal" | "avoid";
export type MnemonicPolicy = "freely" | "only_for_lists" | "avoid";
export type RigourLevel = "high" | "balanced" | "accessible";

export interface TeachingProfile {
  _id: string;
  college_id: string;
  dept_id: string;

  strategy_preference_order: ExplanationStrategy[];

  analogy_policy: AnalogyPolicy;
  mnemonic_policy: MnemonicPolicy;
  rigour_level: RigourLevel;

  always_include_clinical_connect: boolean;
  require_feynman_check: boolean;
  require_misconception_probe: boolean;

  default_bloom_target: BloomLevel;
  default_entry_difficulty: number;
  max_session_minutes: number;
  max_backtrack_depth: number;

  custom_instruction: string;

  configured_by?: string;
  updated_at: Date;
}

// ─── F-20-C: Teaching State Machine / Sessions ─────────────────────────────

export interface PendingCheck {
  question: string;
  expected_answer: string;
  bloom_level: string;
}

export interface CheckHistoryEntry {
  phase: number;
  step_index: number;
  question: string;
  expected_answer: string;
  student_answer: string;
  passed: boolean;
  confidence: number;
  partial_credit: boolean;
  difficulty_level: number;
  strategy_used?: ExplanationStrategy;
  diagnosed_gap?: string;
  matched_misconception_id?: string;
  timestamp: Date;
}

export interface TeachingTurnRecord {
  role: "assistant" | "student";
  phase: number;
  content: string;
  strategy?: ExplanationStrategy;
  difficulty_level?: number;
  image_asset_id?: string;
  created_at: Date;
}

export interface BacktrackStackEntry {
  prerequisite_concept_id: string;
  parent_phase: number;
  parent_step_index: number;
  opened_at: Date;
  closed_at?: Date;
}

export type TeachingSessionStatus = "in_progress" | "completed" | "abandoned";

export interface TeachingSession {
  _id: string;
  student_id: string;
  college_id: string;
  dept_id: string;
  subject_id?: string;
  doc_id: string;
  concept_id: string;

  parent_session_id?: string;
  is_nested: boolean;
  backtrack_stack: BacktrackStackEntry[];
  backtrack_active: boolean;

  current_phase: number;
  current_step_index: number;
  build_steps_total: number;
  build_steps_remaining: number;
  current_difficulty_level: number;
  current_strategy?: ExplanationStrategy;
  strategies_attempted: ExplanationStrategy[];
  strategies_failed: ExplanationStrategy[];
  enabled_phases?: number[];
  phase_turn_count: number;
  turn_count: number;

  awaiting_check_response: boolean;
  pending_check?: PendingCheck | null;

  turns: TeachingTurnRecord[];
  check_history: CheckHistoryEntry[];

  status: TeachingSessionStatus;
  misconception_addressed_id?: string;
  misconception_corrected?: boolean;
  feynman_score?: number;
  final_mastery_estimate?: number;
  srs_cards_created: string[];
  consolidation_summary?: string;

  total_checks: number;
  checks_passed: number;
  rungs_dropped: number;
  backtracks_triggered: number;
  duration_seconds?: number;
  tokens_used: number;
  cost_usd: number;

  started_at: Date;
  completed_at?: Date;
}

export type StudentControl =
  | "i_dont_get_it"
  | "simpler"
  | "go_deeper"
  | "show_picture"
  | "just_tell_me"
  | "skip_ahead"
  | "end_session";
