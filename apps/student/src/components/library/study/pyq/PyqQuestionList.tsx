'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { fetchChapterPyq, type PYQQuestion, type ChapterPyqResponse } from '@/lib/library';
import { PyqQuestion } from './PyqQuestion';

interface Props {
  collegeId:    string;
  docId:        string;
  chapterIndex: number;
  chapterTitle: string;
  onClose:      () => void;
}

export function PyqQuestionList({ collegeId, docId, chapterIndex, chapterTitle, onClose }: Props) {
  const token = useAuthStore(s => s.token) ?? '';
  const [data,    setData]    = useState<ChapterPyqResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchChapterPyq(collegeId, docId, chapterIndex, token)
      .then(d  => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [collegeId, docId, chapterIndex, token]);

  const filtered = data?.questions.filter(q =>
    filter === 'all' ? true : q.year === filter,
  ) ?? [];

  return (
    <div className="mt-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-300">
          Past Year Questions
        </p>
        <button
          onClick={onClose}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          ✕ Close
        </button>
      </div>

      <p className="text-xs text-gray-600 mb-3 leading-relaxed">{chapterTitle}</p>

      {loading && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!loading && !error && data && (
        <>
          {/* Year filter pills */}
          {data.years_covered.length > 1 && (
            <div className="flex flex-wrap gap-1 mb-3">
              <button
                onClick={() => setFilter('all')}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  filter === 'all'
                    ? 'bg-amber-900/50 border-amber-700 text-amber-400'
                    : 'border-gray-700 text-gray-500 hover:border-gray-600'
                }`}
              >
                All ({data.total_count})
              </button>
              {data.years_covered.map(y => (
                <button
                  key={y}
                  onClick={() => setFilter(y)}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                    filter === y
                      ? 'bg-amber-900/50 border-amber-700 text-amber-400'
                      : 'border-gray-700 text-gray-500 hover:border-gray-600'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="text-xs text-gray-600">No questions found.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto pr-1 space-y-0">
              {filtered.map(q => (
                <PyqQuestion key={q._id} question={q} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
