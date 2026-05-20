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
