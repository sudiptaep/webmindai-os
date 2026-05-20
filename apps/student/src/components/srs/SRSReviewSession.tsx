'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { submitReview, suspendCard, type SrsCard } from '@/hooks/useSRS';
import { SRSCard } from './SRSCard';
import { SRSRatingBar } from './SRSRatingBar';

interface ReviewSummary {
  total: number;
  correct: number;
  streak: number;
}

interface SRSReviewSessionProps {
  cards: SrsCard[];
}

export function SRSReviewSession({ cards }: SRSReviewSessionProps) {
  const router = useRouter();
  const { token, user } = useAuthStore();
  const [queue, setQueue] = useState<SrsCard[]>(cards);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const cardStartRef = useRef<number>(Date.now());

  useEffect(() => {
    cardStartRef.current = Date.now();
    setRevealed(false);
  }, [currentIdx]);

  const handleReveal = useCallback(() => setRevealed(true), []);

  const handleRate = useCallback(async (quality: number) => {
    if (!token || !user || submitting) return;
    const card = queue[currentIdx];
    if (!card) return;

    const elapsed = Math.round((Date.now() - cardStartRef.current) / 1000);
    setSubmitting(true);
    try {
      const result = await submitReview(token, user.college_id, card._id, quality, elapsed);
      const newCorrect = quality >= 3 ? correctCount + 1 : correctCount;

      if (currentIdx + 1 >= queue.length) {
        setSummary({ total: queue.length, correct: newCorrect, streak: result.streak });
      } else {
        setCorrectCount(newCorrect);
        setCurrentIdx(i => i + 1);
      }
    } catch {
      // Skip card on error — don't block the session
      if (currentIdx + 1 >= queue.length) {
        setSummary({ total: queue.length, correct: correctCount, streak: 0 });
      } else {
        setCurrentIdx(i => i + 1);
      }
    } finally {
      setSubmitting(false);
    }
  }, [token, user, submitting, queue, currentIdx, correctCount]);

  const handleSuspend = useCallback(async () => {
    if (!token || !user) return;
    const card = queue[currentIdx];
    if (!card) return;
    await suspendCard(token, user.college_id, card._id);
    // Remove from queue and advance
    const newQueue = queue.filter((_, i) => i !== currentIdx);
    if (newQueue.length === 0) {
      setSummary({ total: cards.length, correct: correctCount, streak: 0 });
    } else {
      setQueue(newQueue);
      setCurrentIdx(i => Math.min(i, newQueue.length - 1));
    }
  }, [token, user, queue, currentIdx, cards.length, correctCount]);

  if (summary) {
    return <ReviewDone summary={summary} onRestart={() => router.push('/srs')} />;
  }

  const card = queue[currentIdx];
  if (!card) return null;

  const progress = currentIdx / queue.length;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-teal-600 transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-500 shrink-0 tabular-nums">
          {currentIdx}/{queue.length}
        </span>
      </div>

      {/* Card */}
      <SRSCard
        card={card}
        revealed={revealed}
        onReveal={handleReveal}
        onSuspend={handleSuspend}
      />

      {/* Rating bar — only shown after reveal */}
      {revealed && (
        <SRSRatingBar onRate={handleRate} disabled={submitting} />
      )}
    </div>
  );
}

interface ReviewDoneProps {
  summary: ReviewSummary;
  onRestart: () => void;
}

function ReviewDone({ summary, onRestart }: ReviewDoneProps) {
  const pct = summary.total > 0
    ? Math.round((summary.correct / summary.total) * 100)
    : 0;

  return (
    <div className="bg-[#151820] border border-gray-800/60 rounded-xl p-10 text-center space-y-4">
      <div className="text-4xl">{pct >= 80 ? '🏆' : pct >= 60 ? '👍' : '💪'}</div>
      <h3 className="text-lg font-semibold text-gray-100">Session Complete!</h3>
      <div className="flex items-center justify-center gap-6 py-2">
        <div className="text-center">
          <p className="text-2xl font-bold text-teal-400">{summary.correct}</p>
          <p className="text-xs text-gray-500">Correct</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-300">{summary.total - summary.correct}</p>
          <p className="text-xs text-gray-500">Again</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-orange-400">{summary.streak}</p>
          <p className="text-xs text-gray-500">Day streak</p>
        </div>
      </div>
      <p className="text-sm text-gray-500">{pct}% retention this session</p>
      <button
        onClick={onRestart}
        className="px-6 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors"
      >
        Back to Overview
      </button>
    </div>
  );
}
