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

export interface Session {
  _id: string;
  student_id: string;
  college_id: string;
  dept_id: string;
  messages: Message[];
  started_at: Date;
  last_active: Date;
}

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
