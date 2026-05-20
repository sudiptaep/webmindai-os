'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { addCaseToSRS, type CaseForStudent } from '@/hooks/useClinicalCase';

const DIFFICULTY_COLOR: Record<string, string> = {
  recall:      'text-green-400 border-green-800/40 bg-green-900/10',
  application: 'text-amber-400 border-amber-800/40 bg-amber-900/10',
  analysis:    'text-red-400 border-red-800/40 bg-red-900/10',
};

interface CaseDisplayProps {
  clinicalCase: CaseForStudent;
  collegeId:    string;
  onGenerateNew: () => void;
}

export function CaseDisplay({ clinicalCase: c, collegeId, onGenerateNew }: CaseDisplayProps) {
  const { token } = useAuthStore();
  const [revealed,    setRevealed]    = useState(false);
  const [addedToSRS,  setAddedToSRS]  = useState(false);
  const [srsLoading,  setSrsLoading]  = useState(false);
  const [srsError,    setSrsError]    = useState<string | null>(null);

  const hasMCQ = c.options.length > 0;

  async function handleAddToSRS() {
    if (!token) return;
    setSrsLoading(true);
    setSrsError(null);
    try {
      await addCaseToSRS(token, collegeId, c.case_id);
      setAddedToSRS(true);
    } catch (e) {
      setSrsError((e as Error).message);
    } finally {
      setSrsLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700/50 capitalize">
          {c.question_type}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${DIFFICULTY_COLOR[c.difficulty] ?? ''}`}>
          {c.difficulty}
        </span>
        {c.from_cache && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/20 text-blue-400 border border-blue-800/30">
            cached
          </span>
        )}
        {c.source_pages.length > 0 && (
          <span className="text-[10px] text-gray-600 ml-auto">
            p.{c.source_pages.join(', ')}
          </span>
        )}
      </div>

      {/* Scenario */}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Clinical Scenario</p>
        <p className="text-xs text-gray-300 leading-relaxed bg-gray-900/60 rounded-lg p-3 border border-gray-800/60">
          {c.case_text}
        </p>
      </div>

      {/* Question */}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Question</p>
        <p className="text-xs font-medium text-gray-200 leading-relaxed">{c.question}</p>
      </div>

      {/* MCQ options */}
      {hasMCQ && (
        <div className="space-y-1">
          {c.options.map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isCorrect = revealed && (
              c.correct_answer === letter ||
              c.correct_answer.startsWith(letter + '.') ||
              c.correct_answer === opt
            );
            return (
              <div
                key={i}
                className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-[11px] border ${
                  isCorrect
                    ? 'border-teal-700/50 bg-teal-900/20 text-teal-300'
                    : 'border-gray-700/30 text-gray-400'
                }`}
              >
                <span className="font-mono shrink-0 text-gray-500">{letter}.</span>
                <span>{opt}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Reveal / answer */}
      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full py-2 rounded-lg border border-teal-700/40 text-teal-400 hover:bg-teal-700/10 text-xs font-medium transition-colors"
        >
          Show Answer
        </button>
      ) : (
        <div className="space-y-2.5 pt-1">
          {/* Answer */}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Answer</p>
            <p className="text-xs text-teal-300 font-medium leading-relaxed">{c.correct_answer}</p>
          </div>

          {/* Expected answer (for SAQ/open types) */}
          {c.expected_answer && c.expected_answer !== c.correct_answer && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Model Answer</p>
              <p className="text-xs text-gray-300 leading-relaxed bg-gray-900/40 rounded-lg p-2.5 border border-gray-800/40">
                {c.expected_answer}
              </p>
            </div>
          )}

          {/* Key teaching points */}
          {c.key_teaching_points.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Teaching Points</p>
              <ul className="space-y-1">
                {c.key_teaching_points.map((pt, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-400">
                    <span className="text-teal-600 mt-0.5 shrink-0">·</span>
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* SRS button */}
          <div className="flex gap-2 pt-1">
            {!addedToSRS ? (
              <button
                onClick={handleAddToSRS}
                disabled={srsLoading}
                className="flex-1 py-1.5 rounded-lg border border-teal-700/40 text-teal-400 hover:bg-teal-700/10 text-[11px] font-medium transition-colors disabled:opacity-50"
              >
                {srsLoading ? 'Adding…' : '+ Add to Review Deck'}
              </button>
            ) : (
              <p className="flex-1 text-center text-[11px] text-teal-500 py-1.5">✓ Added to review deck</p>
            )}
            <button
              onClick={onGenerateNew}
              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 text-[11px] transition-colors"
            >
              New
            </button>
          </div>
          {srsError && <p className="text-[10px] text-red-400">{srsError}</p>}
        </div>
      )}
    </div>
  );
}
