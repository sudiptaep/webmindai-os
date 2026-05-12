'use client';

import { useState, useRef, useEffect, KeyboardEvent, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useChatStore, type SourceCitation } from '@/store/chat.store';
import { useAuthStore } from '@/store/auth.store';
import { refreshAccessToken } from '@/lib/auth';
import { MessageBubble } from './MessageBubble';
import { GenericFallbackBanner } from './GenericFallbackBanner';

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
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, isStreaming, sessionId, addMessage, appendToken, finalizeMessage, setStreaming, setSessionId } =
    useChatStore();
  const { token, user, refreshToken, clearAuth } = useAuthStore();

  // Initialise session from prop (history resume)
  useEffect(() => {
    if (initialSessionId) setSessionId(initialSessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    const prompt = STARTER_PROMPTS[0].replace('{subject}', subject.name);
    setInput(prompt);
  }

  function handleStarterPrompt(template: string, subject: SubjectSuggestion) {
    const prompt = template.replace('{subject}', subject.name);
    setInput('');
    sendMessage(prompt);
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <span className="font-semibold text-gray-100">AI Assistant</span>
        <div className="flex gap-4">
          <button onClick={() => router.push('/library')} className="text-sm text-gray-400 hover:text-gray-100">Library</button>
          <button onClick={() => router.push('/history')} className="text-sm text-gray-400 hover:text-gray-100">History</button>
          <button onClick={() => router.push('/profile')} className="text-sm text-gray-400 hover:text-gray-100">Profile</button>
        </div>
      </div>

      {/* Fallback banner */}
      <div className="px-4 pt-3">
        <GenericFallbackBanner />
      </div>

      {/* Messages / Welcome */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 max-w-2xl mx-auto text-center pb-8">
            <div>
              <div className="text-4xl mb-3">🎓</div>
              <h2 className="text-lg font-semibold text-gray-100 mb-1">What would you like to learn today?</h2>
              <p className="text-sm text-gray-500">Ask anything about your course material, or pick a subject below.</p>
            </div>

            {subjects.length > 0 && (
              <div className="w-full">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Your subjects</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {subjects.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleSubjectChip(s)}
                      className="text-sm px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-teal-600 text-gray-200 rounded-full transition-colors"
                    >
                      {s.name}
                      {s.code && <span className="ml-1 text-gray-500 text-xs">{s.code}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {subjects.length > 0 && (
              <div className="w-full">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Try asking</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {subjects.slice(0, 4).map((s) => (
                    STARTER_PROMPTS.slice(1, 3).map((tpl) => (
                      <button
                        key={`${s.id}-${tpl}`}
                        onClick={() => handleStarterPrompt(tpl, s)}
                        className="text-xs text-left px-3 py-2.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-600 text-gray-400 hover:text-gray-200 rounded-xl transition-colors"
                      >
                        {tpl.replace('{subject}', s.name)}
                      </button>
                    ))
                  )).flat().slice(0, 6)}
                </div>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-800 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Ask a question… (Shift+Enter for new line)"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-teal-500"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 rounded-xl px-4 py-2 text-sm font-medium transition-colors shrink-0"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
