import { create } from 'zustand';

export interface SourceCitation {
  doc_id: string;
  title: string;
  page?: number;
  subject?: string;
  chunk_index?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCitation[];
  confidence_score?: number;
  answered?: boolean;
  streaming?: boolean;
}

interface ChatState {
  sessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  setSessionId: (id: string) => void;
  addMessage: (msg: Message) => void;
  appendToken: (id: string, token: string) => void;
  finalizeMessage: (id: string, sources: SourceCitation[], confidence: number, answered: boolean) => void;
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

  finalizeMessage: (id, sources, confidence_score, answered) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id
          ? { ...m, sources, confidence_score, answered, streaming: false }
          : m
      ),
    })),

  setStreaming: (v) => set({ isStreaming: v }),

  reset: () => set({ sessionId: null, messages: [], isStreaming: false }),
}));
