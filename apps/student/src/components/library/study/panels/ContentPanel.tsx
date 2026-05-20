'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { type Chapter, getAccessToken } from '@/lib/library';
import { ChapterHeader } from '../chapter/ChapterHeader';
import { ChapterChat } from '../chat/ChapterChat';
import { ChapterSummary } from '../chat/ChapterSummary';
import { PdfViewer } from '@/components/library/DocumentViewer/PdfViewer';

type Tab = 'chat' | 'read' | 'summary';

interface Props {
  chapter: Chapter | null;
  docId: string;
  collegeId: string;
  onSwitchChapter?: (chapterIndex: number) => void;
}

export function ContentPanel({ chapter, docId, collegeId, onSwitchChapter }: Props) {
  const token = useAuthStore(s => s.token) ?? '';
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [pdfUrl, setPdfUrl]       = useState<string | null>(null);
  const [pdfError, setPdfError]   = useState<string | null>(null);

  // Fetch access token when Read tab selected
  useEffect(() => {
    if (activeTab !== 'read' || !chapter || pdfUrl) return;
    setPdfError(null);
    getAccessToken(collegeId, docId, 'preview', token)
      .then(res => setPdfUrl(res.token_url))
      .catch(e => setPdfError((e as Error).message ?? 'Failed to load PDF'));
  }, [activeTab, chapter, collegeId, docId, token, pdfUrl]);

  // Reset PDF URL when chapter changes so new tab load re-fetches correct position
  useEffect(() => {
    setPdfUrl(null);
    setPdfError(null);
  }, [chapter?.chapter_index]);

  if (!chapter) {
    return (
      <main className="flex-1 flex items-center justify-center text-gray-600 text-sm border-r border-gray-800">
        Select a chapter to begin
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col border-r border-gray-800 overflow-hidden">
      <ChapterHeader chapter={chapter} />

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-800 shrink-0 px-4">
        {([
          { key: 'chat',    label: 'Chat' },
          { key: 'read',    label: 'Read' },
          { key: 'summary', label: 'Summary' },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`text-xs px-4 py-2.5 border-b-2 transition-colors ${
              activeTab === key
                ? 'text-teal-400 border-teal-500'
                : 'text-gray-400 border-transparent hover:text-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content — all tabs stay mounted; CSS hides inactive ones */}
      <div className="flex-1 overflow-hidden flex flex-col relative">
        <div className={`absolute inset-0 flex flex-col ${activeTab === 'chat' ? '' : 'hidden'}`}>
          <ChapterChat
            chapter={chapter}
            docId={docId}
            collegeId={collegeId}
            onSwitchChapter={onSwitchChapter}
          />
        </div>

        <div className={`absolute inset-0 flex flex-col overflow-hidden ${activeTab === 'read' ? '' : 'hidden'}`}>
          {pdfError && (
            <div className="flex-1 flex items-center justify-center text-red-400 text-sm p-6">{pdfError}</div>
          )}
          {!pdfError && !pdfUrl && activeTab === 'read' && (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {pdfUrl && (
            <PdfViewer tokenUrl={pdfUrl} initialPage={chapter.start_page} />
          )}
        </div>

        <div className={`absolute inset-0 flex flex-col overflow-hidden ${activeTab === 'summary' ? '' : 'hidden'}`}>
          <ChapterSummary
            chapter={chapter}
            docId={docId}
            collegeId={collegeId}
          />
        </div>
      </div>
    </main>
  );
}
