export type DepartmentType = "engineering" | "medical" | "generic" | "other";

export interface Department {
  _id: string;
  college_id: string;
  name: string;
  code: string;
  type: DepartmentType;
  is_generic: boolean;
  cannot_delete: boolean;
  pinecone_namespace: string;
  subject_count: number;
  doc_count: number;
  chunk_count: number;
  deleted?: boolean;
  // F-19-E: per-department rerank-score threshold calibration
  rerank_answer_threshold?: number;      // below this → refuse (default 0.35)
  rerank_confident_threshold?: number;   // below this → answer with hedge (default 0.60)
  threshold_calibrated_at?: Date;
  threshold_calibration_sample_size?: number;
  // F-19-F: true hybrid search — BM25 sparse encoder, fitted corpus-wide, admin-triggered
  bm25_encoder_path?: string;
  bm25_fitted_at?: Date;
  bm25_corpus_size?: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateDepartmentInput {
  name: string;
  code: string;
  type: DepartmentType;
  college_id: string;
}
