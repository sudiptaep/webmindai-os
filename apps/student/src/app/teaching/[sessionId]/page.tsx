'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { AppShell } from '@/components/AppSidebar';
import { trpc } from '@/lib/trpc';

const PHASE_NAMES = [
  'Diagnose', 'Anchor', 'Build', 'Visualise', 'Worked example',
  'Guided practice', 'Common error', 'Why it matters', 'Explain it back', 'Recap',
];

interface DisplayTurn {
  role: 'assistant' | 'student';
  content: string;
  phase: number;
  isBacktrackNotice?: boolean;
  isComplete?: boolean;
  srsCardsCreated?: number;
}

const CONTROLS: Array<{ key: string; label: string }> = [
  { key: 'i_dont_get_it', label: "I don't get it" },
  { key: 'simpler', label: 'Simpler' },
  { key: 'go_deeper', label: 'Go deeper' },
  { key: 'show_picture', label: 'Show me a picture' },
  { key: 'just_tell_me', label: 'Just tell me' },
  { key: 'skip_ahead', label: 'Skip ahead' },
  { key: 'end_session', label: 'End session' },
];

export default function TeachingSessionPage({ params }: { params: { sessionId: string } }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { token } = useAuthStore();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.replace('/login');
  }, [mounted, token, router]);

  if (!mounted || !token) return null;

  return (
    <AppShell>
      <SessionContent sessionId={params.sessionId} />
    </AppShell>
  );
}

function SessionContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { token } = useAuthStore();
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: session, isLoading } = trpc.teaching.get.useQuery(
    { session_id: sessionId },
    { enabled: !!token, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (session && !hydrated) {
      setTurns(
        session.turns.map((t) => ({
          role: t.role,
          content: t.content,
          phase: t.phase,
        })),
      );
      setHydrated(true);
    }
  }, [session, hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  function applyTurnResult(turn: any) {
    if (turn.resume_parent_session_id) {
      // Backtrack resolved — switch to the parent session's URL so
      // subsequent respond() calls target the right session.
      router.replace(`/teaching/${turn.resume_parent_session_id}`);
    }
    setTurns((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: turn.content,
        phase: turn.phase,
        isBacktrackNotice: turn.is_backtrack_notice,
        isComplete: turn.is_session_complete,
        srsCardsCreated: turn.srs_cards_created,
      },
    ]);
  }

  const respond = trpc.teaching.respond.useMutation({ onSuccess: applyTurnResult });
  const control = trpc.teaching.control.useMutation({ onSuccess: applyTurnResult });

  function send() {
    const text = input.trim();
    if (!text || respond.isPending || control.isPending) return;
    setTurns((prev) => [...prev, { role: 'student', content: text, phase: turns.at(-1)?.phase ?? 0 }]);
    setInput('');
    respond.mutate({ session_id: sessionId, response: text });
  }

  const busy = respond.isPending || control.isPending;
  const lastTurn = turns.at(-1);
  const isComplete = session?.status !== 'in_progress' || !!lastTurn?.isComplete;
  const currentPhase = session?.current_phase ?? lastTurn?.phase ?? 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <p className="p-6 text-sm text-gray-400">Session not found.</p>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] max-w-2xl mx-auto">
      <div className="px-4 sm:px-6 pt-4 pb-2 border-b border-gray-800">
        <button onClick={() => router.push('/teaching')} className="text-xs text-gray-500 hover:text-gray-300 mb-2">
          ← Teach me
        </button>
        <PhaseProgressBar currentPhase={currentPhase} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
        {turns.map((t, i) => (
          <TurnBubble key={i} turn={t} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <div className="w-3.5 h-3.5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
            Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {isComplete ? (
        <div className="px-4 sm:px-6 py-4 border-t border-gray-800 flex gap-3">
          <button
            onClick={() => router.push('/teaching')}
            className="flex-1 bg-teal-700 hover:bg-teal-600 text-white text-sm rounded-lg py-2.5"
          >
            Back to concepts
          </button>
          <button
            onClick={() => router.push('/srs')}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-lg py-2.5"
          >
            Review queue
          </button>
        </div>
      ) : (
        <div className="border-t border-gray-800 px-4 sm:px-6 py-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {CONTROLS.map((c) => (
              <button
                key={c.key}
                onClick={() => {
                  setTurns((prev) => [...prev, { role: 'student', content: `[${c.label}]`, phase: currentPhase }]);
                  control.mutate({ session_id: sessionId, control: c.key as any });
                }}
                disabled={busy}
                className="text-xs bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-400 rounded-full px-3 py-1 disabled:opacity-40"
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type your answer…"
              rows={1}
              className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-teal-700 resize-none"
            />
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="bg-teal-700 hover:bg-teal-600 disabled:opacity-40 text-white text-sm rounded-lg px-4"
            >
              Send
            </button>
          </div>
          {(respond.isError || control.isError) && (
            <p className="text-xs text-red-400">{(respond.error ?? control.error)?.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseProgressBar({ currentPhase }: { currentPhase: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {PHASE_NAMES.map((name, i) => (
        <div key={name} className="flex items-center gap-1 shrink-0">
          <div
            className={`w-2 h-2 rounded-full ${
              i < currentPhase ? 'bg-teal-600' : i === currentPhase ? 'bg-teal-400 ring-2 ring-teal-900' : 'bg-gray-700'
            }`}
          />
          {i < PHASE_NAMES.length - 1 && <div className={`w-3 h-px ${i < currentPhase ? 'bg-teal-700' : 'bg-gray-800'}`} />}
        </div>
      ))}
      <span className="ml-2 text-xs text-gray-500 whitespace-nowrap">
        {PHASE_NAMES[currentPhase] ?? ''}
      </span>
    </div>
  );
}

function TurnBubble({ turn }: { turn: DisplayTurn }) {
  if (turn.role === 'student') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-teal-800/40 border border-teal-800/60 text-teal-50 text-sm rounded-2xl rounded-br-sm px-4 py-2 whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {turn.isBacktrackNotice && (
          <p className="text-xs text-amber-400 flex items-center gap-1">⏸ Pausing to cover a gap first</p>
        )}
        <div
          className={`text-sm rounded-2xl rounded-bl-sm px-4 py-3 whitespace-pre-wrap ${
            turn.isComplete
              ? 'bg-gray-900 border border-teal-900 text-gray-100'
              : 'bg-gray-900 border border-gray-800 text-gray-200'
          }`}
        >
          {turn.content}
        </div>
        {turn.isComplete && typeof turn.srsCardsCreated === 'number' && turn.srsCardsCreated > 0 && (
          <p className="text-xs text-gray-500">
            🔄 {turn.srsCardsCreated} card{turn.srsCardsCreated === 1 ? '' : 's'} added to your review queue.
          </p>
        )}
      </div>
    </div>
  );
}
