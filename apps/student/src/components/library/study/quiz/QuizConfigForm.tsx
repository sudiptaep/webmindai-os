'use client';

import { useState } from 'react';
import type { QuizQuestionType, QuizDifficulty, GenerateQuizBody } from '@/lib/library';

interface Props {
  chapterTitle: string;
  hasPyq: boolean;
  onGenerate: (body: GenerateQuizBody) => void;
  loading: boolean;
}

const TYPES: { key: QuizQuestionType; label: string }[] = [
  { key: 'MCQ',   label: 'MCQ'     },
  { key: 'TF',    label: 'T / F'   },
  { key: 'SAQ',   label: 'SAQ'     },
  { key: 'MIXED', label: 'Mixed'   },
];

const DIFFS: { key: QuizDifficulty; label: string }[] = [
  { key: 'recall',      label: 'Recall'      },
  { key: 'application', label: 'Application' },
  { key: 'analysis',    label: 'Analysis'    },
  { key: 'adaptive',    label: 'Adaptive'    },
];

export function QuizConfigForm({ chapterTitle, hasPyq, onGenerate, loading }: Props) {
  const [qType,   setQType]   = useState<QuizQuestionType>('MCQ');
  const [diff,    setDiff]    = useState<QuizDifficulty>('application');
  const [count,   setCount]   = useState(10);
  const [pyq,     setPyq]     = useState(false);
  const [timed,   setTimed]   = useState(false);
  const [secPerQ, setSecPerQ] = useState(60);

  function handleSubmit() {
    onGenerate({
      question_type:           qType,
      difficulty:              diff,
      count,
      include_pyq:             pyq,
      timed,
      time_limit_per_question: timed ? secPerQ : undefined,
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 leading-relaxed">
        {chapterTitle}
      </p>

      {/* Question type */}
      <div>
        <p className="text-xs text-gray-500 mb-1.5">Type</p>
        <div className="grid grid-cols-4 gap-1">
          {TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setQType(t.key)}
              className={`text-xs py-1.5 rounded-lg border transition-colors ${
                qType === t.key
                  ? 'bg-violet-900/60 border-violet-600 text-violet-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Difficulty */}
      <div>
        <p className="text-xs text-gray-500 mb-1.5">Difficulty</p>
        <div className="grid grid-cols-2 gap-1">
          {DIFFS.map(d => (
            <button
              key={d.key}
              onClick={() => setDiff(d.key)}
              className={`text-xs py-1.5 rounded-lg border transition-colors ${
                diff === d.key
                  ? 'bg-violet-900/60 border-violet-600 text-violet-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-gray-500">Questions</p>
          <span className="text-xs font-semibold text-gray-300">{count}</span>
        </div>
        <input
          type="range"
          min={5} max={40} step={5}
          value={count}
          onChange={e => setCount(Number(e.target.value))}
          className="w-full accent-violet-500"
        />
        <div className="flex justify-between text-xs text-gray-700 mt-0.5">
          <span>5</span><span>40</span>
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-2">
        {hasPyq && (
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-gray-400">Include PYQ questions</span>
            <button
              onClick={() => setPyq(v => !v)}
              className={`w-9 h-5 rounded-full transition-colors relative ${pyq ? 'bg-amber-600' : 'bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${pyq ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </label>
        )}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-xs text-gray-400">Timed mode</span>
          <button
            onClick={() => setTimed(v => !v)}
            className={`w-9 h-5 rounded-full transition-colors relative ${timed ? 'bg-violet-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${timed ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </label>
        {timed && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-gray-500">Seconds per question</p>
              <span className="text-xs font-semibold text-gray-300">{secPerQ}s</span>
            </div>
            <input
              type="range"
              min={15} max={180} step={15}
              value={secPerQ}
              onChange={e => setSecPerQ(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full text-xs py-2.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white font-medium transition-colors"
      >
        {loading ? 'Generating…' : 'Generate Quiz'}
      </button>
    </div>
  );
}
