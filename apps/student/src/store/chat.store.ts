import { create } from 'zustand';

export interface SourceCitation {
  doc_id: string;
  title: string;
  page?: number;
  subject?: string;
  chunk_index?: number;
}

export interface ChatImage {
  image_asset_id: string;
  token_url: string;
  thumbnail_url: string;
  caption: string;
  image_type: string;
  source_page: number;
  doc_filename: string;
  alt_text: string;
  labels: string[];
  relevance_score: number;
}

/** Set when the request never reached RAG (429 budget/rate-limit, 401, 5xx, network
 * failure) — distinct from a genuine "no relevant content" answer from the model. */
export type ChatErrorType = 'budget' | 'rate_limit' | 'auth' | 'server' | 'network';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCitation[];
  images?: ChatImage[];
  confidence_score?: number;
  answered?: boolean;
  streaming?: boolean;
  errorType?: ChatErrorType;
  errorMessage?: string;
}

interface ChatState {
  sessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  setSessionId: (id: string) => void;
  addMessage: (msg: Message) => void;
  appendToken: (id: string, token: string) => void;
  finalizeMessage: (id: string, sources: SourceCitation[], confidence: number, answered: boolean, images?: ChatImage[]) => void;
  setMessageError: (id: string, errorType: ChatErrorType, errorMessage: string) => void;
  setStreaming: (v: boolean) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  messages: [],
  isStreaming: false,

  setSessionId: (id) => set({ sessionId: id }),

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  appendToken: (id, token) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + token } : m
      ),
    })),

  finalizeMessage: (id, sources, confidence_score, answered, images) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id
          ? { ...m, sources, confidence_score, answered, images, streaming: false }
          : m
      ),
    })),

  setMessageError: (id, errorType, errorMessage) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, errorType, errorMessage, streaming: false } : m
      ),
    })),

  setStreaming: (v) => set({ isStreaming: v }),

  reset: () => set({ sessionId: null, messages: [], isStreaming: false }),
}));
