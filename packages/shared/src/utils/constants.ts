export const CONFIDENCE_THRESHOLD = 0.60;

// F-19-E: rerank-score three-band thresholds — replaces the single cosine gate above.
// A cross-encoder rerank score is a calibrated relevance judgment; a bi-encoder cosine
// score is not comparable across queries, which is why the old single 0.60 cutoff on
// cosine similarity produced both false refusals and false confident answers.
export const RAG_RERANK_ANSWER_THRESHOLD = 0.35;    // below this → refuse, log as content gap
export const RAG_RERANK_CONFIDENT_THRESHOLD = 0.60; // below this (but above answer) → answer with hedge
export const IMAGE_CONFIDENCE_THRESHOLD = 0.45;
export const IMAGE_TOP_K = 5;

export const CHUNK_SIZE = 512;
export const CHUNK_OVERLAP = 50;
export const EMBEDDING_DIMS = 1536;
export const EMBEDDING_MODEL = "text-embedding-3-small";

export const RAG_TOP_K_RETRIEVE = 10;
export const RAG_TOP_K_RERANK = 5;
export const RAG_CONVERSATION_TURNS = 6;

// F-18-B: adaptive top-K by query complexity — replaces the fixed RAG_TOP_K_RERANK
export const RAG_ADAPTIVE_TOPK_SIMPLE = 3;
export const RAG_ADAPTIVE_TOPK_MULTIPART = 6;
export const RAG_ADAPTIVE_TOPK_CASE = 8;
export const RAG_MMR_LAMBDA = 0.7; // relevance vs diversity balance (1.0 = pure relevance)

export const LLM_MODEL_CHAT = "claude-haiku-4-5-20251001";
export const LLM_MODEL_EXAM = "claude-sonnet-4-6";
export const LLM_MAX_TOKENS = 2048; // F-18-D: raised from 1048 — was truncating clinical-case answers mid-sentence
export const LLM_CONTINUATION_MAX_TOKENS = 1024;
export const LLM_TRUNCATION_ALERT_THRESHOLD_PCT = 5;

export const ACCESS_TOKEN_TTL = "1h";
export const REFRESH_TOKEN_TTL = "7d";

export const RATE_LIMIT_CHAT_PER_MINUTE = 10;
export const SEMANTIC_CACHE_TTL_SECONDS = 86400;

export const GENERIC_DEPT_CODE = "GEN";
export const GENERIC_DEPT_NAME = "General";

export const ALLOWED_FILE_TYPES = ["pdf", "pptx", "mp4", "mkv", "mp3", "m4a", "docx"] as const;
export const MAX_FILE_SIZE_PDF = 200 * 1024 * 1024;
export const MAX_FILE_SIZE_PPTX = 200 * 1024 * 1024;
export const MAX_FILE_SIZE_VIDEO = 2 * 1024 * 1024 * 1024;
export const MAX_FILE_SIZE_AUDIO = 500 * 1024 * 1024;
export const MAX_FILE_SIZE_DOCX = 200 * 1024 * 1024;

export const DEFAULT_TOKEN_LIMIT_PER_MONTH = 5_000_000;
export const TOKEN_LIMIT_WARNING_THRESHOLD = 0.80;

export const UNANSWERED_CLUSTER_THRESHOLD = 3;
export const UNANSWERED_CLUSTER_WINDOW_HOURS = 24;
