'use client';

import type { QuizResults as Results } from '@/lib/library';

interface Props {
  results:     Results;
  totalCount:  number;
  onRetry:     () => void;
  onNewQuiz:   () => void;
}

function ScoreRing({ pct }: { pct: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 75 ? '#2dd4bf' : pct >= 50 ? '#f59e0b' : '#f87171';

  return (
    <svg width="72" height="72" className="shrink-0">
      <circle cx="36" cy="36" r={r} fill="none" stroke="#1f2937" strokeWidth="6" />
      <circle
        cx="36" cy="36" r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" fontSize="14" fontWeight="700" fill={color}>
        {pct}%
      </text>
    </svg>
  );
}

export function QuizResults({ results, totalCount, onRetry, onNewQuiz }: Props) {
  const { score_pct, correct_count, total_count, weak_topics, strong_topics,
          pyq_coverage_pct, pyq_would_pass_count, recommendation } = results;

  const grade =
    score_pct >= 80 ? { label: 'Excellent', color: 'text-teal-400' }
    : score_pct >= 60 ? { label: 'Good', color: 'text-amber-400' }
    : score_pct >= 40 ? { label: 'Fair', color: 'text-orange-400' }
    : { label: 'Needs work', color: 'text-red-400' };

  return (
    <div className="space-y-4">
      {/* Score header */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4">
        <ScoreRing pct={score_pct} />
        <div>
          <p className={`text-sm font-semibold ${grade.color}`}>{grade.label}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {correct_count} / {total_count} correct
          </p>
          {pyq_coverage_pct > 0 && (
            <p className="text-xs text-amber-500 mt-0.5">
              ~{pyq_coverage_pct}% PYQ coverage
            </p>
          )}
        </div>
      </div>

      {/* Topics */}
      {(strong_topics.length > 0 || weak_topics.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          {strong_topics.length > 0 && (
            <div className="bg-teal-950/40 border border-teal-900/60 rounded-xl p-3">
              <p className="text-xs font-semibold text-teal-400 mb-2">Strong</p>
              <div className="space-y-1">
                {strong_topics.map(t => (
                  <p key={t} className="text-xs text-gray-400">{t}</p>
                ))}
              </div>
            </div>
          )}
          {weak_topics.length > 0 && (
            <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3">
              <p className="text-xs font-semibold text-red-400 mb-2">Weak</p>
              <div className="space-y-1">
                {weak_topics.map(t => (
                  <p key={t} className="text-xs text-gray-400">{t}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI recommendation */}
      {recommendation && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <p className="text-xs font-semibold text-gray-400 mb-1.5">Study tip</p>
          <p className="text-xs text-gray-300 leading-relaxed">{recommendation}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="flex-1 text-xs py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white font-medium transition-colors"
        >
          Retry Quiz
        </button>
        <button
          onClick={onNewQuiz}
          className="flex-1 text-xs py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-colors"
        >
          New Config
        </button>
      </div>
    </div>
  );
}
