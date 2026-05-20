'use client';

import type { CaseQuestionType, CaseDifficulty } from '@/hooks/useClinicalCase';

const QUESTION_TYPES: { id: CaseQuestionType; label: string; desc: string }[] = [
  { id: 'diagnosis',     label: 'Diagnosis',     desc: 'Identify the condition' },
  { id: 'management',   label: 'Management',    desc: 'Next best step' },
  { id: 'investigation', label: 'Investigation', desc: 'Choose the test' },
  { id: 'mechanism',    label: 'Mechanism',     desc: 'Why does it occur' },
  { id: 'complication', label: 'Complication',  desc: 'Identify the side effect' },
];

const DIFFICULTIES: { id: CaseDifficulty; label: string }[] = [
  { id: 'recall',      label: 'Recall'       },
  { id: 'application', label: 'Application'  },
  { id: 'analysis',    label: 'Analysis'     },
];

interface CaseConfigProps {
  questionType: CaseQuestionType;
  difficulty:   CaseDifficulty;
  loading:      boolean;
  onTypeChange:       (v: CaseQuestionType) => void;
  onDifficultyChange: (v: CaseDifficulty) => void;
  onGenerate:   () => void;
  onShowHistory: () => void;
  historyCount: number;
}

export function CaseConfig({
  questionType, difficulty, loading,
  onTypeChange, onDifficultyChange, onGenerate, onShowHistory, historyCount,
}: CaseConfigProps) {
  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Case Type</p>
        <div className="space-y-1">
          {QUESTION_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => onTypeChange(t.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                questionType === t.id
                  ? 'bg-teal-900/30 border border-teal-700/50 text-teal-300'
                  : 'border border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/60'
              }`}
            >
              <span className="font-medium">{t.label}</span>
              <span className="text-[10px] opacity-60">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Difficulty */}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Difficulty</p>
        <div className="flex gap-1.5">
          {DIFFICULTIES.map(d => (
            <button
              key={d.id}
              onClick={() => onDifficultyChange(d.id)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                difficulty === d.id
                  ? 'bg-teal-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onGenerate}
          disabled={loading}
          className="flex-1 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
        >
          {loading ? 'Generating…' : 'Generate Case'}
        </button>
        {historyCount > 0 && (
          <button
            onClick={onShowHistory}
            className="px-3 py-2 rounded-lg border border-gray-700/50 text-gray-500 hover:text-gray-300 text-xs transition-colors"
          >
            {historyCount}
          </button>
        )}
      </div>
    </div>
  );
}
