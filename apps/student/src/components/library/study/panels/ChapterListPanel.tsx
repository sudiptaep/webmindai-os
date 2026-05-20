'use client';

import { type Chapter } from '@/lib/library';
import { ChapterList } from '../chapter/ChapterList';

interface Props {
  chapters: Chapter[];
  activeIndex: number | null;
  onSelect: (chapter: Chapter) => void;
}

export function ChapterListPanel({ chapters, activeIndex, onSelect }: Props) {
  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-gray-800 bg-gray-950 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800 shrink-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Chapters</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ChapterList
          chapters={chapters}
          activeIndex={activeIndex}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
}
