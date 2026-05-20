'use client';

import type { PYQQuestion } from '@/lib/library';

interface Props {
  question:   PYQQuestion;
  onAddToQuiz?: (q: PYQQuestion) => void;
}

const TYPE_LABEL: Record<string, string> = {
  MCQ: 'MCQ', SAQ: 'SAQ', LAQ: 'LAQ', CASE: 'Case', FIB: 'Fill',
};

export function PyqQuestion({ question, onAddToQuiz }: Props) {
  const typeLabel = TYPE_LABEL[question.question_type] ?? question.question_type;

  return (
    <div className="border-b border-gray-800 pb-3 mb-3 last:border-0 last:mb-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs text-amber-400 font-semibold">{question.year}</span>
        {question.exam_name && (
          <span className="text-xs text-gray-600">{question.exam_name}</span>
        )}
        <span className="ml-auto text-xs bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
          {typeLabel}
          {question.marks > 0 && ` · ${question.marks}m`}
        </span>
      </div>
      <p className="text-xs text-gray-300 leading-relaxed">{question.question_text}</p>
      {onAddToQuiz && (
        <button
          onClick={() => onAddToQuiz(question)}
          className="mt-1.5 text-xs text-violet-500 hover:text-violet-400 transition-colors"
        >
          + Add to quiz
        </button>
      )}
    </div>
  );
}
