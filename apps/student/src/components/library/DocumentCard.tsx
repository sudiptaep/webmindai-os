'use client';

import { type DocCard, formatDuration } from '@/lib/library';

interface Props {
  doc: DocCard;
  collegeId: string;
  onPreview: (docId: string) => void;
  onAiSummary: (docId: string, pageCount?: number, fileType?: string) => void;
}

const FILE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  pdf:  { icon: '📄', color: 'text-red-400',    bg: 'bg-red-950/40'    },
  pptx: { icon: '📊', color: 'text-orange-400', bg: 'bg-orange-950/40' },
  mp4:  { icon: '🎬', color: 'text-purple-400', bg: 'bg-purple-950/40' },
  mkv:  { icon: '🎬', color: 'text-purple-400', bg: 'bg-purple-950/40' },
  mp3:  { icon: '🎵', color: 'text-blue-400',   bg: 'bg-blue-950/40'   },
  m4a:  { icon: '🎵', color: 'text-blue-400',   bg: 'bg-blue-950/40'   },
  docx: { icon: '📝', color: 'text-teal-400',   bg: 'bg-teal-950/40'   },
};

export function DocumentCard({ doc, collegeId, onPreview, onAiSummary }: Props) {
  const cfg = FILE_CONFIG[doc.file_type] ?? { icon: '📎', color: 'text-gray-400', bg: 'bg-gray-800' };
  const isReady = doc.ingestion_status === 'completed';

  return (
    <div className={`group relative bg-gray-900 border rounded-xl p-4 transition-all ${isReady ? 'border-gray-700 hover:border-gray-500 hover:shadow-lg' : 'border-gray-800 opacity-70'}`}>
      {/* Processing badge */}
      {!isReady && (
        <div className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full bg-yellow-900/60 text-yellow-400 border border-yellow-700">
          {doc.ingestion_status === 'processing' ? 'Processing…' : 'In queue'}
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
      <h3 className="text-sm font-semibold text-gray-100 truncate mb-1" title={doc.filename}>
        {doc.filename}
      </h3>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2 flex-wrap">
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
          <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full"
              style={{ width: `${Math.round(doc.quality_score * 100)}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{Math.round(doc.quality_score * 100)}%</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 flex-wrap">
        <button
          onClick={() => isReady && onPreview(doc.doc_id)}
          disabled={!isReady}
          className={`flex-1 text-xs py-1.5 rounded-lg transition-colors text-white ${isReady ? 'bg-teal-700 hover:bg-teal-600' : 'bg-gray-700 cursor-not-allowed'}`}
        >
          Preview
        </button>

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
