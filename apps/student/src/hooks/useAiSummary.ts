'use client';

import { useState, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';

const API = process.env.NEXT_PUBLIC_API_URL!;

type SummaryMode = 'brief' | 'detailed' | 'key-terms';

type State = {
  content: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  tokensUsed: number;
  error: string | null;
};

export function useAiSummary(collegeId: string, docId: string) {
  const { token } = useAuthStore();
  const [state, setState] = useState<State>({ content: '', status: 'idle', tokensUsed: 0, error: null });
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const stop = useCallback(() => {
    readerRef.current?.cancel();
    setState(s => ({ ...s, status: 'done' }));
  }, []);

  const start = useCallback(async (mode: SummaryMode = 'brief', pageFrom?: number, pageTo?: number, chapterIndex?: number) => {
    if (!token) return;
    setState({ content: '', status: 'streaming', tokensUsed: 0, error: null });

    try {
      const qs = new URLSearchParams({ mode });
      if (pageFrom !== undefined)     qs.set('page_from',     String(pageFrom));
      if (pageTo !== undefined)       qs.set('page_to',       String(pageTo));
      if (chapterIndex !== undefined) qs.set('chapter_index', String(chapterIndex));
      const res = await fetch(
        `${API}/api/v1/college/${collegeId}/student/library/${docId}/ai-summary?${qs}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        setState(s => ({ ...s, status: 'error', error: (err as { message?: string }).message ?? 'Request failed' }));
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
          const json = line.slice(6);
          try {
            const evt = JSON.parse(json) as { type: string; content?: string; tokens_used?: number; message?: string };
            if (evt.type === 'token' && evt.content) {
              setState(s => ({ ...s, content: s.content + evt.content }));
            } else if (evt.type === 'done') {
              setState(s => ({ ...s, status: 'done', tokensUsed: evt.tokens_used ?? 0 }));
            } else if (evt.type === 'error') {
              setState(s => ({ ...s, status: 'error', error: evt.message ?? 'Summary error' }));
            }
          } catch { /* malformed SSE line */ }
        }
      }
    } catch (e) {
      setState(s => ({ ...s, status: 'error', error: e instanceof Error ? e.message : 'Network error' }));
    }
  }, [token, collegeId, docId]);

  const reset = useCallback(() => {
    readerRef.current?.cancel();
    setState({ content: '', status: 'idle', tokensUsed: 0, error: null });
  }, []);

  return { ...state, start, stop, reset };
}
