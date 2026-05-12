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
