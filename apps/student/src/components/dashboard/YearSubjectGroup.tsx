'use client';

import Link from 'next/link';
import type { MyYearSubject, MyYearDoc } from '@/hooks/useMyYear';

const FILE_TYPE_ICON: Record<string, string> = {
  pdf: '📄',
  pptx: '📊',
  mp4: '🎬',
  mkv: '🎬',
  mp3: '🎵',
  m4a: '🎵',
  docx: '📝',
};

function DocChip({ doc }: { doc: MyYearDoc }) {
  const icon = FILE_TYPE_ICON[doc.file_type] ?? '📄';
  const shortName = doc.filename.replace(/\.[^/.]+$/, '').slice(0, 28);

  return (
    <Link
      href={`/library/${doc.doc_id}`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f1117] border border-gray-700/50 hover:border-teal-600/40 hover:bg-teal-900/10 text-xs text-gray-300 hover:text-gray-100 transition-all whitespace-nowrap shrink-0"
    >
      <span>{icon}</span>
      <span className="truncate max-w-[140px]">{shortName}</span>
      {doc.has_chapter_map && (
        <span className="ml-0.5 text-[10px] text-teal-500 font-medium">CH</span>
      )}
    </Link>
  );
}

interface YearSubjectGroupProps {
  subject: MyYearSubject;
}

export function YearSubjectGroup({ subject }: YearSubjectGroupProps) {
  return (
    <div className="py-3 border-b border-gray-800/40 last:border-b-0">
      {/* Subject header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">
            {subject.name}
          </span>
          {subject.code && (
            <span className="text-[10px] text-gray-600 font-mono">{subject.code}</span>
          )}
          <span className="text-xs text-gray-600">
            {subject.doc_count} doc{subject.doc_count !== 1 ? 's' : ''}
          </span>
        </div>
        <Link
          href={`/library?subject=${subject.subject_id}`}
          className="text-xs text-teal-500 hover:text-teal-400 transition-colors shrink-0"
        >
          Study all →
        </Link>
      </div>

      {/* Doc chips — horizontal scroll */}
      {subject.docs.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {subject.docs.map(doc => (
            <DocChip key={doc.doc_id} doc={doc} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-600 italic">No documents uploaded yet</p>
      )}

      {/* Disease tags */}
      {subject.disease_tags.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {subject.disease_tags.slice(0, 5).map(tag => (
            <Link
              key={tag}
              href={`/disease?q=${encodeURIComponent(tag.replace(/_/g, ' '))}`}
              className="text-[10px] px-2 py-0.5 rounded-full bg-teal-900/20 border border-teal-800/30 text-teal-500 hover:text-teal-300 hover:bg-teal-900/40 transition-colors"
            >
              {tag.replace(/_/g, ' ')}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
