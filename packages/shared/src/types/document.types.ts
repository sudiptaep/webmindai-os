export type FileType = "pdf" | "pptx" | "mp4" | "mkv" | "mp3" | "m4a" | "docx";
export type IngestionStatus = "pending" | "processing" | "completed" | "failed";
export type LibraryAction = "download" | "extract_text" | "extract_pages" | "ai_summary" | "stream" | "preview";
export type ExtractionJobStatus = "pending" | "processing" | "completed" | "failed" | "cleaned";

export interface Document {
  _id: string;
  dept_id: string;
  subject_id?: string;
  college_id: string;
  original_filename: string;
  file_type: FileType;
  r2_key: string;
  file_path?: string;               // absolute local fs path — populated on upload, backfill via r2_key
  file_size_bytes: number;
  ingestion_status: IngestionStatus;
  ingestion_error?: string;
  chunk_count: number;
  ocr_used: boolean;
  quality_score: number;
  page_count?: number;              // PDF/PPTX total pages
  slide_count?: number;             // PPTX only
  duration_seconds?: number;        // MP4/MP3/M4A only
  download_enabled: boolean;        // default true — admin can block download
  is_visible_to_students: boolean;  // default true — admin can hide from library
  thumbnail_path?: string;          // absolute local path to .jpg thumbnail
  text_cache_path?: string;         // absolute local path to text cache JSON
  transcript_path?: string;         // absolute local path to Whisper transcript JSON
  uploaded_by: string;
  academic_year: string;
  version: number;
  // F-13: populated after chapter extraction completes
  has_chapter_map?: boolean;
  chapter_count?: number;
  // F-17: image intelligence
  image_count_raw?: number;
  image_count_analysed?: number;
  image_count_indexed?: number;
  image_ingestion_status?: ImageIngestionStatus;
  image_ingestion_cost_usd?: number;
  images_enabled?: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Subject {
  _id: string;
  dept_id: string;
  college_id: string;
  name: string;
  code: string;
  semester: number;
  year: number;
  doc_count: number;
  disease_tags?: string[];         // F-14-C: normalised disease names for cross-subject search
  created_at: Date;
}

export interface DownloadLog {
  _id: string;
  student_id: string;
  doc_id: string;
  dept_id: string;
  college_id: string;
  action: LibraryAction;
  ip_address?: string;
  user_agent?: string;
  pages_extracted?: number[];  // only for action = "extract_pages"
  tokens_used?: number;        // only for action = "ai_summary"
  created_at: Date;
}

export interface ExtractionJob {
  _id: string;
  student_id: string;
  doc_id: string;
  college_id: string;
  job_type: "extract_pages" | "extract_slides";
  status: ExtractionJobStatus;
  pages_requested: number[];
  output_file_path?: string;  // absolute local path — server-side only
  output_token?: string;      // Redis token key for serving output file
  error?: string;
  expires_at?: Date;
  created_at: Date;
  completed_at?: Date;
}

export interface IngestionJobPayload {
  job_id: string;
  doc_id: string;
  college_id: string;
  dept_id: string;
  subject_id: string | null;
  r2_key: string;
  file_path?: string;  // absolute local path (set in F-11 upload route)
  file_type: FileType;
  academic_year: string;
  callback_url: string;
  job_type?: "ingest";  // discriminator; absent = "ingest" (backward compat)
}

export interface ExtractionJobPayload {
  job_id: string;
  doc_id: string;
  college_id: string;
  dept_id: string;
  file_path: string;      // absolute local path to source file
  file_type: "pdf" | "pptx";
  pages: number[];        // 1-indexed page numbers to extract
  job_type: "extract_pages";
  callback_url: string;   // POST target for status updates
}

export interface IngestionCallbackPayload {
  status: "completed" | "failed";
  chunk_count?: number;
  quality_score?: number;
  ocr_used?: boolean;
  error?: string;
  // F-11 additions — populated by updated ingestion worker
  text_cache_path?: string;
  thumbnail_path?: string;
  page_count?: number;
  slide_count?: number;
  duration_seconds?: number;
  transcript_path?: string;
}

// ── F-13: Book Intelligence System ────────────────────────────────────────────

export type ExtractionMethod = "pdf_bookmarks" | "heuristic" | "manual";
export type QuizMode = "practice" | "test" | "timed" | "pyq_sim" | "weak_spots" | "socratic";
export type QuizQuestionType = "MCQ" | "TF" | "SAQ" | "CASE" | "MIXED" | "PYQ" | "IMAGE_LABEL";
export type QuizDifficulty = "recall" | "application" | "analysis" | "adaptive";
export type PYQQuestionType = "MCQ" | "SAQ" | "LAQ" | "CASE" | "FIB";

export interface Chapter {
  chapter_index: number;
  title: string;
  subtitle?: string;
  start_page: number;
  end_page: number;
  page_count: number;
  chunk_ids: string[];
  chunk_count: number;
  pyq_count: number;
  pyq_years: string[];
  pyq_question_ids: string[];
  pyq_coverage_score: number;
  avg_class_score?: number;
  study_session_count: number;
}

export interface ChapterMap {
  _id: string;
  doc_id: string;
  college_id: string;
  dept_id: string;
  extraction_method: ExtractionMethod;
  confidence_score: number;
  total_chapters: number;
  total_pages: number;
  chapters: Chapter[];
  created_at: Date;
  updated_at: Date;
}

export interface PYQPaper {
  _id: string;
  college_id: string;
  dept_id: string;
  subject_id: string;
  year: string;
  month?: string;
  exam_name: string;
  university?: string;
  doc_id: string;
  file_path: string;
  ingestion_status: "pending" | "processing" | "completed" | "failed";
  question_count: number;
  pinecone_namespace: string;
  created_at: Date;
  updated_at: Date;
}

export interface PYQQuestion {
  _id: string;
  pyq_paper_id: string;
  college_id: string;
  dept_id: string;
  subject_id: string;
  question_text: string;
  question_type: PYQQuestionType;
  marks: number;
  unit_number?: string;
  section?: string;
  year: string;
  exam_name: string;
  mapped_chapter_indices: number[];
  mapping_confidence: number;
  pinecone_vector_id: string;
  created_at: Date;
}

export interface QuizQuestion {
  question_id: string;
  question_text: string;
  question_type: QuizQuestionType;
  options: string[];
  correct_answer: string;
  explanation: string;
  source_page?: number;
  bloom_level: string;
  difficulty: QuizDifficulty;
  is_pyq: boolean;
  pyq_question_id?: string;
  pyq_year?: string;
  image_asset_id?: string;
  student_answer?: string;
  is_correct?: boolean;
  time_taken_seconds?: number;
  answered_at?: Date;
}

export interface QuizSession {
  _id: string;
  student_id: string;
  doc_id: string;
  chapter_index?: number;
  subject_id: string;
  college_id: string;
  dept_id: string;
  quiz_mode: QuizMode;
  question_type: QuizQuestionType;
  difficulty: QuizDifficulty;
  time_limit_seconds?: number;
  questions: QuizQuestion[];
  status: "in_progress" | "completed" | "abandoned";
  score_pct?: number;
  correct_count?: number;
  total_count: number;
  time_taken_seconds?: number;
  weak_topics: string[];
  strong_topics: string[];
  pyq_coverage_pct?: number;
  pyq_would_pass_count?: number;
  recommendation?: string;
  started_at: Date;
  completed_at?: Date;
}

export interface StudentNote {
  note_id: string;
  content: string;
  source_page?: number;
  pinned_ai_response?: string;
  created_at: Date;
  updated_at: Date;
}

export interface StudentNotes {
  _id: string;
  student_id: string;
  doc_id: string;
  chapter_index: number;
  college_id: string;
  notes: StudentNote[];
  created_at: Date;
  updated_at: Date;
}

export interface ChapterExtractionJobPayload {
  job_id: string;
  doc_id: string;
  college_id: string;
  dept_id: string;
  file_path: string;
  job_type: "extract_chapters";
  callback_url: string;
}

export interface ChapterMapCallbackPayload {
  status: "completed" | "failed";
  chapter_count?: number;
  extraction_method?: ExtractionMethod;
  confidence_score?: number;
  chapters?: Chapter[];
  error?: string;
}

export interface PYQIngestionJobPayload {
  job_id:       string;
  pyq_paper_id: string;
  doc_id:       string;
  college_id:   string;
  dept_id:      string;
  subject_id:   string | undefined;
  file_path:    string;
  year:         string;
  month?:       string;
  exam_name:    string;
  university?:  string;
  callback_url: string;
  job_type:     "ingest_pyq";
}

export interface PYQIngestionCallbackPayload {
  status:         "completed" | "failed";
  question_count?: number;
  error?:          string;
}

// ── F-17: Visual Content Intelligence ─────────────────────────────────────────

export type ImageIngestionStatus = "not_started" | "queued" | "processing" | "completed" | "partial" | "failed";
export type ImageVisionStatus = "pending" | "processing" | "completed" | "failed" | "skipped";
export type ImageType =
  | "anatomical_diagram"
  | "histology"
  | "pathology"
  | "flowchart"
  | "graph_chart"
  | "circuit_diagram"
  | "block_diagram"
  | "chemical_structure"
  | "clinical_image"
  | "photograph"
  | "table_image"
  | "equation"
  | "other";

export interface ImageAsset {
  _id: string;
  doc_id: string;
  college_id: string;
  dept_id: string;
  subject_id?: string;

  file_path: string;
  thumbnail_path: string;
  file_size_bytes: number;
  width_px: number;
  height_px: number;
  format: "jpg" | "png" | "gif" | "webp";

  source_page: number;
  image_index_on_page: number;
  global_image_index: number;
  content_hash: string;

  vision_status: ImageVisionStatus;
  vision_tokens_used?: number;
  description?: string;
  labels_extracted: string[];
  caption?: string;
  image_type?: ImageType;
  clinical_relevance?: string;
  searchable_terms: string[];
  alt_text?: string;

  pinecone_vector_id?: string;
  was_filtered: boolean;
  filter_reason?: "too_small" | "logo_icon" | "low_quality" | "duplicate";
  hidden?: boolean;

  created_at: Date;
  updated_at: Date;
}

export interface ImageIngestionJobPayload {
  job_id: string;
  doc_id: string;
  college_id: string;
  dept_id: string;
  subject_id: string | null;
  file_path: string;
  file_type: "pdf" | "pptx";
  doc_filename: string;
  dept_name: string;
  subject_name?: string;
  academic_year: string;
  job_type: "image_ingestion";
  callback_url: string;
  bulk_save_url: string;
}

export interface ImageIngestionCallbackPayload {
  status: "completed" | "failed";
  image_count_raw?: number;
  image_count_analysed?: number;
  image_count_indexed?: number;
  cost_usd?: number;
  error?: string;
}

export interface ImageToken {
  image_asset_id: string;
  token_url: string;
  thumbnail_url: string;
  caption: string;
  image_type: ImageType;
  source_page: number;
  doc_filename: string;
  alt_text: string;
  labels: string[];
  relevance_score: number;
}
