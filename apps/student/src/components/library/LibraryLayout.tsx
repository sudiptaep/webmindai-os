'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useLibraryDocs } from '@/hooks/useLibraryDocs';
import { type LibraryParams } from '@/lib/library';
import { SubjectSidebar } from './SubjectSidebar';
import { DocumentGrid } from './DocumentGrid';
import { DocumentViewer } from './DocumentViewer';
import { AiSummaryPanel } from './actions/AiSummaryPanel';

interface Props {
  initialDocId?: string;
  initialPage?: number;
}

type ActiveModal = { type: 'ai-summary'; docId: string; pageCount?: number; fileType?: string } | null;

export function LibraryLayout({ initialDocId, initialPage }: Props) {
  const router = useRouter();
  const { user } = useAuthStore();

  const [params, setParams] = useState<LibraryParams>({});
  const [viewerDocId, setViewerDocId] = useState<string | null>(initialDocId ?? null);
  const [viewerPage, setViewerPage] = useState<number | undefined>(initialPage);
  const [modal, setModal] = useState<ActiveModal>(null);

  const { data, loading, error } = useLibraryDocs(params);

  const collegeId = user?.college_id ?? '';

  function mergeParams(patch: Partial<LibraryParams>) {
    setParams(p => ({ ...p, ...patch }));
  }

  function openViewer(docId: string, page?: number) {
    setViewerDocId(docId);
    setViewerPage(page);
  }

  function closeViewer() {
    setViewerDocId(null);
    setViewerPage(undefined);
    if (initialDocId) router.replace('/library');
  }

  const subjects    = data?.subjects ?? [];
  const studentYear = data?.student_year ?? 1;

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      {/* Top nav */}
      <header className="flex items-center gap-4 px-5 py-3 border-b border-gray-800 shrink-0">
        <button onClick={() => router.push('/chat')} className="text-gray-400 hover:text-white text-sm">
          ← Chat
        </button>
        <h1 className="text-sm font-semibold text-gray-100">Document Library</h1>
        {data && (
          <span className="text-xs text-gray-500 ml-auto">{data.total_docs} documents</span>
        )}
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <SubjectSidebar subjects={subjects} params={params} studentYear={studentYear} onChange={mergeParams} />

        {/* Grid */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center flex-1">
              <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center flex-1 text-red-400 text-sm">{error}</div>
          )}
          {!loading && !error && (
            <DocumentGrid
              subjects={subjects}
              collegeId={collegeId}
              onPreview={(docId) => openViewer(docId)}
              onAiSummary={(docId, pageCount, fileType) => setModal({ type: 'ai-summary', docId, pageCount, fileType })}
            />
          )}
        </div>
      </div>

      {/* Viewer slide-over */}
      {viewerDocId && (
        <DocumentViewer
          collegeId={collegeId}
          docId={viewerDocId}
          initialPage={viewerPage}
          onClose={closeViewer}
        />
      )}

      {/* Card-triggered modals */}
      {modal?.type === 'ai-summary' && (
        <AiSummaryPanel
          collegeId={collegeId}
          docId={modal.docId}
          filename=""
          fileType={modal.fileType}
          pageCount={modal.pageCount}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
