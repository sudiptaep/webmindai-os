'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import {
  type Chapter,
  type ChatMode,
  type ChapterChatSession,
  createChapterChatSession,
  setChapterChatMode,
  chapterChatMessageUrl,
} from '@/lib/library';
import { SocraticToggle } from './SocraticToggle';
import { SaveResponseButton } from './SaveResponseButton';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isFallback?: boolean;
  suggestionChapterIndex?: number;
  suggestionChapterTitle?: string;
}

interface Props {
  chapter: Chapter;
  docId: string;
  collegeId: string;
  onSwitchChapter?: (chapterIndex: number) => void;
}

export function ChapterChat({ chapter, docId, collegeId, onSwitchChapter }: Props) {
  const token = useAuthStore(s => s.token) ?? '';

  const [session, setSession]       = useState<ChapterChatSession | null>(null);
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [input, setInput]           = useState('');
  const [streaming, setStreaming]   = useState(false);
  const [initError, setInitError]   = useState<string | null>(null);

  const readerRef      = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  // Init session when chapter changes — loads existing conversation history
  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setMessages([]);
    setInitError(null);

    createChapterChatSession(collegeId, docId, chapter.chapter_index, token)
      .then(s => {
        if (cancelled) return;
        setSession(s);
        // Seed messages from saved session history
        if (s.messages && s.messages.length > 0) {
          setMessages(s.messages.map(m => ({
            id: crypto.randomUUID(),
            role: m.role,
            content: m.content,
          })));
        }
      })
      .catch(e => { if (!cancelled) setInitError((e as Error).message); });

    return () => { cancelled = true; readerRef.current?.cancel(); };
  }, [chapter.chapter_index, docId, collegeId, token]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const switchMode = useCallback(async (mode: ChatMode) => {
    if (!session) return;
    try {
      await setChapterChatMode(collegeId, docId, chapter.chapter_index, session.session_id, mode, token);
      setSession(s => s ? { ...s, chat_mode: mode } : s);
    } catch { /* non-fatal */ }
  }, [session, collegeId, docId, chapter.chapter_index, token]);

  const sendMessage = useCallback(async () => {
    if (!session || !input.trim() || streaming) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input.trim() };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages(m => [...m, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const url = chapterChatMessageUrl(collegeId, docId, chapter.chapter_index, session.session_id);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: userMsg.content }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ message: 'Request failed' }));
        setMessages(m => m.map(msg =>
          msg.id === assistantId
            ? { ...msg, content: (err as { message?: string }).message ?? 'Error' }
            : msg,
        ));
        return;
      }

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buf = '';
      let isFallback = false;
      let suggestionIdx: number | undefined;
      let suggestionTitle: string | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as {
              type: string;
              content?: string;
              message?: string;
              suggestion_chapter_index?: number;
              suggestion_chapter_title?: string;
            };

            if (evt.type === 'token' && evt.content) {
              setMessages(m => m.map(msg =>
                msg.id === assistantId ? { ...msg, content: msg.content + evt.content! } : msg,
              ));
            } else if (evt.type === 'fallback') {
              isFallback = true;
              suggestionIdx = evt.suggestion_chapter_index;
              suggestionTitle = evt.suggestion_chapter_title;
              setMessages(m => m.map(msg =>
                msg.id === assistantId
                  ? { ...msg, content: evt.message ?? '', isFallback: true, suggestionChapterIndex: suggestionIdx, suggestionChapterTitle: suggestionTitle }
                  : msg,
              ));
            }
          } catch { /* malformed SSE */ }
        }
      }
    } catch (e) {
      setMessages(m => m.map(msg =>
        msg.id === assistantId
          ? { ...msg, content: (e instanceof Error ? e.message : 'Network error') }
          : msg,
      ));
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [session, input, streaming, collegeId, docId, chapter.chapter_index, token]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (initError) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm p-6">
        {initError}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-500">
          Scoped to pages {chapter.start_page}–{chapter.end_page}
        </span>
        <SocraticToggle mode={session.chat_mode} onSwitch={switchMode} />
      </div>

      {/* Socratic mode banner */}
      {session.chat_mode === 'socratic' && (
        <div className="px-4 py-2 bg-violet-900/20 border-b border-violet-800/40 text-xs text-violet-300 shrink-0">
          Socratic mode — AI will guide you to the answer, not give it directly.
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm text-center">
            <div>
              <p className="text-2xl mb-2">💬</p>
              <p>Ask anything about Chapter {chapter.chapter_index}:</p>
              <p className="text-xs text-gray-700 mt-1">"{chapter.title}"</p>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                ${msg.role === 'user'
                  ? 'bg-teal-700 text-white rounded-br-sm'
                  : msg.isFallback
                    ? 'bg-amber-900/30 border border-amber-800/50 text-amber-200 rounded-bl-sm'
                    : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                }`}
            >
              {msg.content || (streaming && msg.role === 'assistant' ? (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              ) : null)}

              {/* Chapter suggestion link */}
              {msg.isFallback && msg.suggestionChapterIndex && onSwitchChapter && (
                <button
                  onClick={() => onSwitchChapter(msg.suggestionChapterIndex!)}
                  className="mt-2 block text-xs text-amber-400 underline underline-offset-2 hover:text-amber-300"
                >
                  Go to Chapter {msg.suggestionChapterIndex}: {msg.suggestionChapterTitle}
                </button>
              )}

              {/* Save response button — assistant messages only */}
              {msg.role === 'assistant' && !msg.isFallback && msg.content && (
                <div className="mt-2 flex justify-end">
                  <SaveResponseButton
                    response={msg.content}
                    docId={docId}
                    collegeId={collegeId}
                    chapterIndex={chapter.chapter_index}
                  />
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-4 pb-4 pt-2 border-t border-gray-800 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about Chapter ${chapter.chapter_index}…`}
            rows={1}
            disabled={streaming}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-teal-600 disabled:opacity-50 max-h-32 overflow-y-auto"
            style={{ height: 'auto', minHeight: '42px' }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = 'auto';
              t.style.height = `${Math.min(t.scrollHeight, 128)}px`;
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="p-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-xl transition-colors shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 8L2 2l2.5 6L2 14l12-6z" fill="currentColor" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-700 mt-1.5 pl-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
