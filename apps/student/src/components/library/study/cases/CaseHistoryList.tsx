'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { listCases, type CaseListing, type CaseQuestionType, type CaseDifficulty } from '@/hooks/useClinicalCase';

const DIFFICULTY_DOT: Record<string, string> = {
  recall:      'bg-green-500',
  application: 'bg-amber-500',
  analysis:    'bg-red-500',
};

interface CaseHistoryListProps {
  collegeId:   string;
  docId:       string;
  chapterIdx:  number;
  onSelect:    (item: { questionType: CaseQuestionType; difficulty: CaseDifficulty }) => void;
  onClose:     () => void;
}

export function CaseHistoryList({ collegeId, docId, chapterIdx, onSelect, onClose }: CaseHistoryListProps) {
  const { token } = useAuthStore();
  const [cases,   setCases]   = useState<CaseListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    listCases(token, collegeId, docId, chapterIdx)
      .then(r => setCases(r.cases))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [token, collegeId, docId, chapterIdx]);

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <div className="w-4 h-4 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) return <p className="text-[10px] text-red-400">{error}</p>;

  if (cases.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-[10px] text-gray-600">No cases generated for this chapter yet</p>
        <button onClick={onClose} className="mt-2 text-[10px] text-teal-500 hover:text-teal-400">
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] text-gray-500">{cases.length} case{cases.length !== 1 ? 's' : ''} cached</p>
        <button onClick={onClose} className="text-[10px] text-gray-600 hover:text-gray-400">← Back</button>
      </div>

      {cases.map(c => (
        <button
          key={c._id}
          onClick={() => onSelect({ questionType: c.question_type, difficulty: c.difficulty })}
          className="w-full text-left px-2.5 py-2 rounded-lg border border-gray-800/60 hover:border-teal-800/40 hover:bg-teal-900/10 transition-colors space-y-1"
        >
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DIFFICULTY_DOT[c.difficulty] ?? 'bg-gray-500'}`} />
            <span className="text-[10px] text-gray-400 capitalize">{c.question_type}</span>
            <span className="text-[10px] text-gray-600 capitalize ml-auto">{c.difficulty}</span>
          </div>
          <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">
            {c.case_text.slice(0, 90)}{c.case_text.length > 90 ? '…' : ''}
          </p>
        </button>
      ))}
    </div>
  );
}
