'use client';

import type { SrsCard } from '@/hooks/useSRS';

interface SRSCardProps {
  card: SrsCard;
  revealed: boolean;
  onReveal: () => void;
  onSuspend: () => void;
}

export function SRSCard({ card, revealed, onReveal, onSuspend }: SRSCardProps) {
  const isMCQ = card.question_type === 'MCQ' && card.options.length > 0;

  return (
    <div className="bg-[#151820] border border-gray-800/60 rounded-xl overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-2.5 border-b border-gray-800/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">
            {card.question_type}
          </span>
          <span className="text-[10px] text-gray-600 capitalize">{card.bloom_level}</span>
        </div>
        <button
          onClick={onSuspend}
          className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
        >
          Suspend
        </button>
      </div>

      {/* Question */}
      <div className="px-5 py-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Question</p>
        <p className="text-gray-100 text-sm leading-relaxed">{card.question_text}</p>

        {/* MCQ options (shown before reveal) */}
        {isMCQ && !revealed && (
          <div className="mt-4 space-y-2">
            {card.options.map((opt, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-gray-700/40 text-sm text-gray-300"
              >
                <span className="text-gray-500 font-mono text-xs mt-0.5 shrink-0">
                  {String.fromCharCode(65 + i)}.
                </span>
                <span>{opt}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reveal button or answer */}
      {!revealed ? (
        <div className="px-5 pb-5">
          <button
            onClick={onReveal}
            className="w-full py-2.5 rounded-lg border border-teal-700/50 text-teal-400 hover:bg-teal-700/10 text-sm font-medium transition-colors"
          >
            Show Answer
          </button>
        </div>
      ) : (
        <div className="px-5 pb-5 border-t border-gray-800/60 pt-4 space-y-3">
          {/* Answer */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Answer</p>
            <p className="text-teal-300 text-sm leading-relaxed font-medium">{card.correct_answer}</p>
          </div>

          {/* MCQ options with highlight */}
          {isMCQ && card.options.length > 0 && (
            <div className="space-y-1.5">
              {card.options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const isCorrect = card.correct_answer.startsWith(letter + '.') ||
                                  card.correct_answer === opt ||
                                  card.correct_answer === letter;
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border text-xs ${
                      isCorrect
                        ? 'border-teal-700/60 bg-teal-900/20 text-teal-300'
                        : 'border-gray-700/30 text-gray-500'
                    }`}
                  >
                    <span className="font-mono shrink-0">{letter}.</span>
                    <span>{opt}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Explanation */}
          {card.explanation && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Explanation
              </p>
              <p className="text-gray-400 text-xs leading-relaxed">{card.explanation}</p>
            </div>
          )}

          {/* Ease factor badge */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-gray-600">
              Interval: {card.interval_days}d · Ease: {card.ease_factor.toFixed(2)} · Rep #{card.repetition_count}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
