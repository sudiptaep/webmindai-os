'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';

const API = process.env.NEXT_PUBLIC_API_URL!;

export interface DiseaseChunkResult {
  chunk_id:        string;
  text:            string;
  page_num:        number;
  chapter_title:   string;
  relevance_score: number;
}

export interface DiseaseSubjectResult {
  subject_id:      string;
  subject_name:    string;
  doc_id:          string;
  doc_filename:    string;
  relevant_chunks: DiseaseChunkResult[];
  summary:         string;
}

export interface DiseaseQueryResult {
  disease_name:      string;
  subject_results:   DiseaseSubjectResult[];
  compiled_answer:   string;
  cross_connections: string[];
  from_cache:        boolean;
}

export interface DiseaseSuggestions {
  popular_diseases: string[];
  recent_canonical: string[];
}

export interface ChatMessage {
  id:      string;
  role:    'user' | 'assistant';
  content: string;
}

// ─── Disease search ───────────────────────────────────────────────────────────

export function useDiseaseSearch() {
  const { token, user } = useAuthStore();
  const [result,  setResult]  = useState<DiseaseQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    if (!token || !user || !query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `${API}/api/v1/college/${user.college_id}/student/disease-search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ query: query.trim() }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? 'Search failed');
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  return { result, loading, error, search };
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

export function useDiseaseSuggestions() {
  const { token, user } = useAuthStore();
  const [data,    setData]    = useState<DiseaseSuggestions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !user) return;
    fetch(
      `${API}/api/v1/college/${user.college_id}/student/disease-search/suggestions`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then(r => r.ok ? r.json() : null)
      .then((d: DiseaseSuggestions | null) => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, user]);

  return { data, loading };
}

// ─── Disease chat (SSE) ───────────────────────────────────────────────────────

export function useDiseaseChat(disease: string) {
  const { token, user } = useAuthStore();
  const [messages,  setMessages]  = useState<ChatMessage[]>([]);
  const [input,     setInput]     = useState('');
  const [streaming, setStreaming] = useState(false);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  function stopStream() {
    readerRef.current?.cancel();
    setStreaming(false);
  }

  const sendMessage = useCallback(async (userInput: string) => {
    if (!token || !user || !userInput.trim() || streaming) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: userInput.trim() };
    const assistantId = crypto.randomUUID();

    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);

    const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(
        `${API}/api/v1/college/${user.college_id}/student/disease-chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ disease, query: userInput.trim(), conversation_history: history }),
        },
      );

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ message: 'Chat failed' }));
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: (err as { message?: string }).message ?? 'Chat failed' }
            : m,
        ));
        return;
      }

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; content?: string; message?: string };
            if (evt.type === 'token' && evt.content) {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + evt.content } : m,
              ));
            } else if (evt.type === 'done' || evt.type === 'error') {
              if (evt.type === 'error') {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: evt.message ?? 'Error' } : m,
                ));
              }
              break;
            }
          } catch { /* malformed SSE */ }
        }
      }
    } catch (e) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: e instanceof Error ? e.message : 'Network error' }
          : m,
      ));
    } finally {
      setStreaming(false);
    }
  }, [token, user, disease, messages, streaming]);

  return { messages, input, setInput, streaming, sendMessage, stopStream };
}
