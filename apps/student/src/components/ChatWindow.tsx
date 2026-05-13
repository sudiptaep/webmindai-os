'use client';

import { useState, useRef, useEffect, KeyboardEvent, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useChatStore, type SourceCitation } from '@/store/chat.store';
import { useAuthStore } from '@/store/auth.store';
import { MessageBubble } from './MessageBubble';
import { GenericFallbackBanner } from './GenericFallbackBanner';
import { AppSidebar, AppShell, IconMenu, IconSend } from './AppSidebar';

const API = process.env.NEXT_PUBLIC_API_URL!;

export interface SubjectSuggestion {
  id: string;
  name: string;
  code: string | null;
}

interface ChatWindowProps {
  initialSessionId?: string;
  subjects?: SubjectSuggestion[];
}

const STARTER_PROMPTS = [
  'Explain the key concepts in {subject}',
  'What are the most important topics in {subject}?',
  'Generate practice questions for {subject}',
  'Summarise {subject} for my exam',
];

export function ChatWindow({ initialSessionId, subjects = [] }: ChatWindowProps) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isStreaming, sessionId, addMessage, appendToken, finalizeMessage, setStreaming, setSessionId } =
    useChatStore();
  const { token, user, refreshToken, clearAuth } = useAuthStore();

  useEffect(() => {
    if (initialSessionId) setSessionId(initialSessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  async function sendMessage(text: string) {
    if (!token || !user) { router.push('/login'); return; }

    const userMsgId = crypto.randomUUID();
    addMessage({ id: userMsgId, role: 'user', content: text });

    const assistantMsgId = crypto.randomUUID();
    addMessage({ id: assistantMsgId, role: 'assistant', content: '', streaming: true });
    setStreaming(true);

    try {
      let activeToken = token;
      const chatBody = JSON.stringify({ message: text, session_id: sessionId ?? undefined });

      let response = await fetch(`${API}/api/v1/college/${user.college_id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeToken}` },
        credentials: 'include',
        body: chatBody,
      });

      if (response.status === 401) {
        try {
          activeToken = await refreshToken();
          response = await fetch(`${API}/api/v1/college/${user.college_id}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeToken}` },
            credentials: 'include',
            body: chatBody,
          });
        } catch {
          clearAuth();
          router.push('/login');
          return;
        }
      }

      if (!response.ok || !response.body) {
        finalizeMessage(assistantMsgId, [], 0, false);
        setStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          let event: {
            type: string;
            content?: string;
            sources?: SourceCitation[];
            confidence_score?: number;
            answered?: boolean;
            session_id?: string;
          };
          try { event = JSON.parse(json); } catch { continue; }

          if (event.type === 'token' && event.content) {
            appendToken(assistantMsgId, event.content);
          } else if (event.type === 'done') {
            finalizeMessage(assistantMsgId, event.sources ?? [], event.confidence_score ?? 0, event.answered ?? false);
          } else if (event.type === 'session' && event.session_id) {
            setSessionId(event.session_id);
          }
        }
      }
    } catch {
      finalizeMessage(assistantMsgId, [], 0, false);
    } finally {
      setStreaming(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    sendMessage(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.trim();
      if (!text || isStreaming) return;
      setInput('');
      sendMessage(text);
    }
  }

  function handleSubjectChip(subject: SubjectSuggestion) {
    setInput(STARTER_PROMPTS[0].replace('{subject}', subject.name));
    textareaRef.current?.focus();
  }

  function handleStarterPrompt(template: string, subject: SubjectSuggestion) {
    sendMessage(template.replace('{subject}', subject.name));
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f1117]">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-30 transition-transform duration-200 lg:static lg:translate-x-0 lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <AppSidebar currentSessionId={sessionId} onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Mobile top bar */}
        {!isEmpty && (
          <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/60 shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-gray-400 hover:text-gray-100 cursor-pointer transition-colors"
              aria-label="Open sidebar"
            >
              <IconMenu />
            </button>
            <h1 className="text-sm font-semibold text-gray-200 truncate">
              {messages.find((m) => m.role === 'user')?.content?.slice(0, 60) ?? 'AI Assistant'}
            </h1>
          </header>
        )}

        {/* Fallback banner */}
        <div className="px-4 pt-3 shrink-0">
          <GenericFallbackBanner />
        </div>

        {isEmpty ? (
          /* ── WELCOME: centered input layout ── */
          <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">

            {/* Greeting */}
            <div className="flex items-center gap-3 mb-8">
              {/* Starburst */}
              <svg viewBox="0 0 48 48" className="w-10 h-10 text-teal-400 shrink-0" fill="currentColor">
                <path d="M24 2 L26.2 20.5 L43 12 L29.5 25.8 L48 24 L29.5 22.2 L43 36 L26.2 27.5 L24 46 L21.8 27.5 L5 36 L18.5 22.2 L0 24 L18.5 25.8 L5 12 L21.8 20.5 Z"/>
              </svg>
              <h1 className="text-3xl sm:text-4xl font-semibold text-gray-100 tracking-tight">
                Hey there, {user?.name?.split(' ')[0] ?? 'there'}
              </h1>
            </div>

            {/* Central input box */}
            <form
              onSubmit={handleSubmit}
              className="w-full max-w-2xl"
            >
              <div className="bg-[#1e2230] rounded-2xl p-4 shadow-xl">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={3}
                  placeholder="How can I help you today?"
                  className="w-full bg-transparent text-base text-gray-100 placeholder-gray-600 resize-none focus:outline-none leading-relaxed"
                  style={{ minHeight: '72px', maxHeight: '200px' }}
                />
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/40">
                  <button
                    type="button"
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-700/40 transition-colors cursor-pointer"
                    aria-label="Attach"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                  <button
                    type="submit"
                    disabled={isStreaming || !input.trim()}
                    aria-label="Send message"
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
                  >
                    <IconSend />
                  </button>
                </div>
              </div>
            </form>

            {/* Library link chip */}
            <div className="flex items-center gap-2 mt-5 flex-wrap justify-center">
              <Link
                href="/library"
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-gray-700/60 text-sm text-gray-400 hover:text-gray-100 hover:border-gray-600 transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
                Browse Library
              </Link>
              {subjects.slice(0, 3).map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSubjectChip(s)}
                  className="px-4 py-2 rounded-full border border-gray-700/60 text-sm text-gray-400 hover:text-gray-100 hover:border-gray-600 transition-colors cursor-pointer"
                >
                  {s.name}
                </button>
              ))}
            </div>

          </div>
        ) : (
          /* ── ACTIVE CHAT ── */
          <>
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <div className="px-4 py-6 max-w-3xl mx-auto w-full space-y-1">
                {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Bottom input bar */}
            <div className="shrink-0 px-4 pb-4 pt-2 border-t border-gray-800/60">
              <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
                <div className="flex items-end gap-2 bg-gray-900 border border-gray-700/60 rounded-2xl px-4 py-2.5 focus-within:border-teal-600/50 transition-colors">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder="Ask a question… (Shift+Enter for new line)"
                    className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none leading-relaxed"
                    style={{ minHeight: '24px', maxHeight: '120px' }}
                  />
                  <button
                    type="submit"
                    disabled={isStreaming || !input.trim()}
                    aria-label="Send message"
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
                  >
                    <IconSend />
                  </button>
                </div>
              </form>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
