'use client';

import { type Chapter } from '@/lib/library';

interface Props {
  chapter: Chapter;
  isActive: boolean;
  onSelect: () => void;
}

export function ChapterRow({ chapter, isActive, onSelect }: Props) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 border-b border-gray-800/70 hover:bg-gray-800/60 transition-all
        ${isActive ? 'bg-teal-900/30 border-l-2 border-l-teal-400' : 'border-l-2 border-l-transparent'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-gray-500 mt-0.5 shrink-0">
          Ch {chapter.chapter_index}
        </span>
        <span className="text-xs text-gray-200 flex-1 leading-tight text-left">
          {chapter.title}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-1.5 ml-5 flex-wrap">
        <span className="text-xs text-gray-600">
          Pg {chapter.start_page}–{chapter.end_page}
        </span>
        {chapter.chunk_count > 0 && (
          <span className="text-xs text-gray-700">
            · {chapter.chunk_count} chunks
          </span>
        )}
        {chapter.pyq_count > 0 && (
          <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-800/60 px-1.5 py-0.5 rounded">
            {chapter.pyq_count} PYQ{chapter.pyq_count !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </button>
  );
}
