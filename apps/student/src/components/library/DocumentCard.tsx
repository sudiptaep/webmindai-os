'use client';

import { useState, useRef, useEffect } from 'react';
import { type DocCard, formatDuration } from '@/lib/library';

interface Props {
  doc: DocCard;
  collegeId: string;
  onPreview: (docId: string) => void;
  onAiSummary: (docId: string, pageCount?: number, fileType?: string) => void;
  onStudy: (docId: string) => void;
}

const FILE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  pdf:  { icon: '📄', color: 'text-destructive',    bg: 'bg-red-100 dark:bg-red-950/40'    },
  pptx: { icon: '📊', color: 'text-orange-400', bg: 'bg-orange-950/40' },
  mp4:  { icon: '🎬', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-950/40' },
  mkv:  { icon: '🎬', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-950/40' },
  mp3:  { icon: '🎵', color: 'text-primary',   bg: 'bg-blue-950/40'   },
  m4a:  { icon: '🎵', color: 'text-primary',   bg: 'bg-blue-950/40'   },
  docx: { icon: '📝', color: 'text-teal-700 dark:text-teal-400',   bg: 'bg-teal-100 dark:bg-teal-950/40'   },
};

export function DocumentCard({ doc, collegeId, onPreview, onAiSummary, onStudy }: Props) {
  const cfg    = FILE_CONFIG[doc.file_type] ?? { icon: '📎', color: 'text-muted-foreground', bg: 'bg-muted' };
  const isReady = doc.ingestion_status === 'completed';
  const [studyOpen, setStudyOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!studyOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setStudyOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [studyOpen]);

  return (
    <div className={`group relative bg-card border rounded-xl p-4 transition-all ${isReady ? 'border-border hover:border-gray-500 hover:shadow-lg' : 'border-border opacity-70'}`}>
      {/* Processing badge */}
      {!isReady && (
        <div className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/60 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700">
          {doc.ingestion_status === 'processing' ? 'Processing…' : 'In queue'}
        </div>
      )}

      {/* Chapter count badge — top-right when ready */}
      {isReady && doc.has_chapter_map && doc.chapter_count && (
        <div className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 border border-teal-800">
          {doc.chapter_count} ch.
        </div>
      )}

      {/* Thumbnail / icon */}
      <div className={`${cfg.bg} rounded-lg aspect-video flex items-center justify-center mb-3 overflow-hidden`}>
        {doc.thumbnail_url ? (
          <img src={doc.thumbnail_url} alt={doc.filename} className="w-full h-full object-cover" />
        ) : (
          <span className="text-4xl">{cfg.icon}</span>
        )}
      </div>

      {/* Filename */}
      <h3 className="text-sm font-semibold text-foreground truncate mb-1" title={doc.filename}>
        {doc.filename}
      </h3>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2 flex-wrap">
        <span className={`${cfg.bg} ${cfg.color} px-1.5 py-0.5 rounded font-medium uppercase`}>
          {doc.file_type}
        </span>
        <span>{doc.file_size_display}</span>
        {doc.page_count && <span>· {doc.page_count}p</span>}
        {doc.slide_count && <span>· {doc.slide_count} slides</span>}
        {doc.duration_seconds && <span>· {formatDuration(doc.duration_seconds)}</span>}
      </div>

      {/* Quality bar */}
      {doc.quality_score > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full"
              style={{ width: `${Math.round(doc.quality_score * 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{Math.round(doc.quality_score * 100)}%</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => isReady && onPreview(doc.doc_id)}
          disabled={!isReady}
          className={`flex-1 text-xs py-1.5 rounded-lg transition-colors text-white ${isReady ? 'bg-teal-700 hover:bg-teal-600' : 'bg-accent cursor-not-allowed'}`}
        >
          Preview
        </button>

        {/* Study dropdown — PDF only, when chapter map exists */}
        {isReady && doc.file_type === 'pdf' && doc.has_chapter_map && (
          <div className="relative" ref={dropRef}>
            <button
              onClick={() => setStudyOpen(o => !o)}
              className="text-xs px-2.5 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded-lg transition-colors flex items-center gap-1"
            >
              Study <span className="text-[10px]">▾</span>
            </button>
            {studyOpen && (
              <div className="absolute right-0 bottom-full mb-1 w-48 bg-muted border border-border rounded-lg shadow-xl z-20 overflow-hidden">
                <button
                  onClick={() => { setStudyOpen(false); onStudy(doc.doc_id); }}
                  className="w-full text-left text-xs px-3 py-2.5 text-foreground hover:bg-accent transition-colors"
                >
                  Open Chapter Navigator
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => onAiSummary(doc.doc_id, doc.page_count ?? doc.slide_count ?? undefined, doc.file_type)}
          className="text-xs px-2.5 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg transition-colors"
        >
          AI
        </button>
      </div>
    </div>
  );
}
