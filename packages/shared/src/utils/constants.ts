export const CONFIDENCE_THRESHOLD = 0.60;

export const CHUNK_SIZE = 512;
export const CHUNK_OVERLAP = 50;
export const EMBEDDING_DIMS = 1536;
export const EMBEDDING_MODEL = "text-embedding-3-small";

export const RAG_TOP_K_RETRIEVE = 10;
export const RAG_TOP_K_RERANK = 5;
export const RAG_CONVERSATION_TURNS = 6;

export const LLM_MODEL_CHAT = "claude-haiku-4-5-20251001";
export const LLM_MODEL_EXAM = "claude-sonnet-4-6";
export const LLM_MAX_TOKENS = 1048;

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
