'use client';

import { type Chapter } from '@/lib/library';

interface Props {
  chapter: Chapter;
}

export function ChapterHeader({ chapter }: Props) {
  return (
    <div className="px-5 py-3 border-b border-gray-800 shrink-0 bg-gray-900/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 mb-0.5">
            Chapter {chapter.chapter_index}
          </p>
          <h2 className="text-sm font-semibold text-gray-100 leading-tight truncate">
            {chapter.title}
          </h2>
          {chapter.subtitle && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{chapter.subtitle}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-500">Pg {chapter.start_page}–{chapter.end_page}</p>
          <p className="text-xs text-gray-600 mt-0.5">
            {chapter.page_count}p · {chapter.chunk_count} chunks
          </p>
        </div>
      </div>

      {chapter.pyq_count > 0 && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-xs text-amber-400">
            {chapter.pyq_count} past exam questions
          </span>
          {chapter.pyq_years.map(y => (
            <span
              key={y}
              className="text-xs bg-amber-900/30 text-amber-500 border border-amber-800/50 px-1.5 py-0.5 rounded"
            >
              {y}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
