'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { fetchChapters, type Chapter, type ChapterMapResponse } from '@/lib/library';
import { ChapterListPanel } from './panels/ChapterListPanel';
import { ContentPanel } from './panels/ContentPanel';
import { ToolsPanel } from './panels/ToolsPanel';

interface Props {
  collegeId: string;
  docId: string;
  onClose: () => void;
}

export function BookStudyWorkspace({ collegeId, docId, onClose }: Props) {
  const token = useAuthStore(s => s.token) ?? '';

  const [chapterMap, setChapterMap] = useState<ChapterMapResponse | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchChapters(collegeId, docId, token)
      .then(data => {
        if (cancelled) return;
        setChapterMap(data);
        if (data.chapters.length > 0) setActiveChapter(data.chapters[0]);
      })
      .catch(err => {
        if (!cancelled) setError((err as Error).message ?? 'Failed to load chapters');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [collegeId, docId, token]);

  // Trap Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">
      {/* Workspace header */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 shrink-0">
        <button
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1"
        >
          ← Library
        </button>
        <div className="w-px h-4 bg-gray-700" />
        <h1 className="text-sm font-semibold text-gray-100 truncate flex-1">
          {chapterMap?.doc_name ?? '—'}
        </h1>
        {chapterMap && (
          <span className="text-xs text-gray-500 shrink-0">
            {chapterMap.total_chapters} chapters · {chapterMap.total_pages} pages
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-2 text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors shrink-0"
        >
          Exit Study
        </button>
      </header>

      {/* Loading / error state */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {error && (
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Three-panel layout */}
      {!loading && !error && chapterMap && (
        <div className="flex flex-1 overflow-hidden">
          <ChapterListPanel
            chapters={chapterMap.chapters}
            activeIndex={activeChapter?.chapter_index ?? null}
            onSelect={setActiveChapter}
          />
          <ContentPanel
            chapter={activeChapter}
            docId={docId}
            collegeId={collegeId}
            onSwitchChapter={(idx) => {
              const ch = chapterMap.chapters.find(c => c.chapter_index === idx);
              if (ch) setActiveChapter(ch);
            }}
          />
          <ToolsPanel
            chapter={activeChapter}
            docId={docId}
            collegeId={collegeId}
          />
        </div>
      )}
    </div>
  );
}
