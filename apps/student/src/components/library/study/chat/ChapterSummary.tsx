'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { type Chapter } from '@/lib/library';
import { useAiSummary } from '@/hooks/useAiSummary';

type Mode = 'brief' | 'detailed' | 'key-terms';

const MODES: { id: Mode; label: string }[] = [
  { id: 'brief',     label: 'Brief'     },
  { id: 'detailed',  label: 'Detailed'  },
  { id: 'key-terms', label: 'Key Terms' },
];

interface Props {
  chapter: Chapter;
  docId: string;
  collegeId: string;
}

function summaryKey(userId: string, collegeId: string, docId: string, chapterIndex: number, mode: Mode) {
  return `summary:${userId}:${collegeId}:${docId}:${chapterIndex}:${mode}`;
}

export function ChapterSummary({ chapter, docId, collegeId }: Props) {
  const userId = useAuthStore(s => s.user?._id ?? '');
  const [mode, setMode] = useState<Mode>('brief');
  const { content, status, error, start, stop, reset } = useAiSummary(collegeId, docId);

  // Load cached summary from localStorage when chapter or mode changes
  useEffect(() => {
    reset();
    if (!userId) return;
    const cached = localStorage.getItem(summaryKey(userId, collegeId, docId, chapter.chapter_index, mode));
    if (cached) {
      // Inject cached content — re-use start() would re-call API; instead patch via a hidden init
      // Use a short-circuit: set content via the hook's reset+inject pattern
      // Since useAiSummary doesn't expose setContent, store in local state overlay
      setCachedContent(cached);
    } else {
      setCachedContent(null);
    }
  }, [chapter.chapter_index, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const [cachedContent, setCachedContent] = useState<string | null>(null);

  // Persist to localStorage when streaming completes
  useEffect(() => {
    if (status === 'done' && content && userId) {
      localStorage.setItem(summaryKey(userId, collegeId, docId, chapter.chapter_index, mode), content);
      setCachedContent(null); // live content takes over
    }
  }, [status, content, userId, collegeId, docId, chapter.chapter_index, mode]);

  const displayContent = content || cachedContent;

  function handleGenerate() {
    setCachedContent(null);
    reset();
    setTimeout(() => start(mode, chapter.start_page, chapter.end_page), 0);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Mode bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800 shrink-0 flex-wrap">
        <span className="text-xs text-gray-500 mr-1">Mode:</span>
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              mode === m.id
                ? 'bg-teal-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {m.label}
          </button>
        ))}
        <div className="flex-1" />
        {status === 'streaming' ? (
          <button
            onClick={stop}
            className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-full"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleGenerate}
            className="text-xs px-3 py-1 bg-teal-700 hover:bg-teal-600 text-white rounded-full transition-colors"
          >
            {content ? 'Regenerate' : 'Generate'}
          </button>
        )}
      </div>

      {/* Scope label */}
      <div className="px-4 py-1.5 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-600">
          Chapter {chapter.chapter_index}: {chapter.title} · Pages {chapter.start_page}–{chapter.end_page}
        </span>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {status === 'idle' && !displayContent && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-3">
            <span className="text-3xl">✨</span>
            <p className="text-sm">Select a mode and generate a summary for this chapter.</p>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {displayContent && (
          <div className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed whitespace-pre-wrap">
            {displayContent}
            {status === 'streaming' && (
              <span className="inline-block w-1.5 h-4 bg-teal-400 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
