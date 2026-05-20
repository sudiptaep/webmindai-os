'use client';

import { type Chapter } from '@/lib/library';
import { ChapterRow } from './ChapterRow';

interface Props {
  chapters: Chapter[];
  activeIndex: number | null;
  onSelect: (chapter: Chapter) => void;
}

export function ChapterList({ chapters, activeIndex, onSelect }: Props) {
  if (chapters.length === 0) {
    return (
      <div className="p-4 text-xs text-gray-600 text-center">
        No chapters found
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {chapters.map(ch => (
        <ChapterRow
          key={ch.chapter_index}
          chapter={ch}
          isActive={activeIndex === ch.chapter_index}
          onSelect={() => onSelect(ch)}
        />
      ))}
    </div>
  );
}
