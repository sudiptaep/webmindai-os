export type MessageRole = "user" | "assistant";

export interface SourceCitation {
  doc_id: string;
  filename: string;
  page?: number;
  slide?: number;
  timestamp?: number;
  subject?: string;
  chunk_preview?: string;
}

export interface Message {
  role: MessageRole;
  content: string;
  sources: SourceCitation[];
  confidence_score?: number;
  answered: boolean;
  timestamp: Date;
}

export type ChatMode = "answer" | "socratic";

export interface Session {
  _id: string;
  student_id: string;
  college_id: string;
  dept_id: string;
  messages: Message[];
  started_at: Date;
  last_active: Date;
  // F-13: populated for chapter-scoped chat sessions
  doc_id?: string;
  chapter_index?: number;
  chat_mode?: ChatMode;
}

export type QueryComplexity = "simple" | "multi_part" | "case_based";

export interface QueryLog {
  _id: string;
  student_id: string;
  session_id: string;
  college_id: string;
  dept_id: string;
  query_text: string;
  answered: boolean;
  confidence_score: number;
  sources_used: string[];
  flagged_to_admin: boolean;
  response_time_ms: number;
  tokens_used: number;
  created_at: Date;
  // F-18-B: retrieval telemetry
  retrieved_chunk_ids?: string[];
  cited_chunk_ids?: string[];
  retrieval_precision?: number;
  query_complexity?: QueryComplexity;
  top_k_used?: number;
  mmr_applied?: boolean;
  query_rewritten_text?: string;
  // F-18-C: rerank monitoring
  rerank_top_score?: number;
  rerank_score_spread?: number;
  rerank_candidate_count?: number;
  // F-18-D: truncation telemetry
  stop_reason?: string;
  was_truncated?: boolean;
  was_truncated_and_continued?: boolean;
}

export interface SSETokenEvent {
  type: "token";
  content: string;
}

export interface SSEDoneEvent {
  type: "done";
  sources: SourceCitation[];
  confidence_score: number;
  answered: boolean;
}

export type SSEEvent = SSETokenEvent | SSEDoneEvent;
