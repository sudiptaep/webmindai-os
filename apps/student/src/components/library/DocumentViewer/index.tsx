'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { fetchDocument, getAccessToken, type DocMeta, type AccessTokenResponse } from '@/lib/library';
import { PdfViewer } from './PdfViewer';
import { VideoPlayer } from './VideoPlayer';
import { AudioPlayer } from './AudioPlayer';
import { DocxViewer } from './DocxViewer';
import { PptxViewer } from './PptxViewer';
import { AiSummaryPanel } from '../actions/AiSummaryPanel';

interface Props {
  collegeId: string;
  docId: string;
  initialPage?: number;
  onClose: () => void;
}

type Modal = 'ai-summary' | null;

export function DocumentViewer({ collegeId, docId, initialPage, onClose }: Props) {
  const { token } = useAuthStore();
  const [doc, setDoc] = useState<DocMeta | null>(null);
  const [tokenRes, setTokenRes] = useState<AccessTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);

    fetchDocument(collegeId, docId, token)
      .then(async (d) => {
        setDoc(d);
        const resolvedIntent: 'preview' | 'stream' =
          ['mp4', 'mkv', 'mp3', 'm4a'].includes(d.file_type) ? 'stream' : 'preview';
        const t = await getAccessToken(collegeId, docId, resolvedIntent, token);
        setTokenRes(t);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load document'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeId, docId, token]);

  function renderViewer() {
    if (!doc || !tokenRes) return null;
    const { file_type, original_filename } = doc;
    const url = tokenRes.token_url;

    if (file_type === 'pdf')             return <PdfViewer tokenUrl={url} initialPage={initialPage} />;
    if (file_type === 'pptx')            return <PptxViewer collegeId={collegeId} docId={docId} slideCount={doc.slide_count ?? 1} thumbnailUrl={null} />;
    if (file_type === 'mp4' || file_type === 'mkv') return <VideoPlayer tokenUrl={url} collegeId={collegeId} docId={docId} filename={original_filename} />;
    if (file_type === 'mp3' || file_type === 'm4a') return <AudioPlayer tokenUrl={url} collegeId={collegeId} docId={docId} filename={original_filename} />;
    if (file_type === 'docx')            return <DocxViewer collegeId={collegeId} docId={docId} />;
    return <div className="flex items-center justify-center h-full text-gray-400">Preview not available for this file type</div>;
  }

  return (
    <>
      {/* Slide-over backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-5xl flex flex-col bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700 shrink-0">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
          <h2 className="flex-1 text-sm font-semibold text-gray-100 truncate">
            {doc?.original_filename ?? '…'}
          </h2>

          {/* Action bar */}
          {doc && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setModal('ai-summary')}
                className="text-xs px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
              >
                AI Summary
              </button>
            </div>
          )}
        </div>

        {/* Viewer body */}
        <div className="flex-1 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
          )}
          {!loading && !error && renderViewer()}
        </div>
      </div>

      {/* Modals */}
      {modal === 'ai-summary' && doc && (
        <AiSummaryPanel
          collegeId={collegeId} docId={docId}
          filename={doc.original_filename}
          fileType={doc.file_type}
          pageCount={doc.page_count ?? doc.slide_count ?? undefined}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
