'use client';

import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

export default function DocumentDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { token, user } = useAuthStore();
  const collegeId = user?.college_id ?? '';

  const { data: doc, isLoading } = trpc.document.get.useQuery(
    { college_id: collegeId, doc_id: params.id },
    { enabled: !!collegeId && !!token }
  );

  const { data: quality, refetch: refetchQuality } = trpc.document.qualityBreakdown.useQuery(
    { college_id: collegeId, doc_id: params.id },
    { enabled: !!collegeId && !!token }
  );

  const reingest        = trpc.document.reingest.useMutation();
  const extractChapters = trpc.document.extractChapters.useMutation();
  const rescore         = trpc.document.rescore.useMutation({
    onSuccess: () => refetchQuality(),
  });
  const deleteMut       = trpc.document.delete.useMutation({
    onSuccess: () => router.push('/dashboard/documents'),
  });

  if (isLoading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (!doc) return <p className="text-gray-400 text-sm">Document not found.</p>;

  return (
    <div className="max-w-2xl">
      <button
        onClick={() => router.back()}
        className="text-sm text-gray-400 hover:text-gray-100 mb-4 flex items-center gap-1"
      >
        ← Back
      </button>
      <h1 className="text-xl font-semibold mb-6 break-all">{doc.original_filename}</h1>

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 space-y-3 text-sm">
        <Row label="Status" value={doc.ingestion_status} />
        <Row label="File type" value={doc.file_type} />
        <Row label="Department" value={doc.dept_id} />
        {doc.subject_id && <Row label="Subject" value={doc.subject_id} />}
        {doc.chunk_count != null && <Row label="Chunks" value={String(doc.chunk_count)} />}
        {doc.quality_score != null && <Row label="Quality score" value={doc.quality_score.toFixed(2)} />}
        {doc.ocr_used != null && <Row label="OCR used" value={doc.ocr_used ? 'Yes' : 'No'} />}
        <Row label="Chapter map" value={
          (doc as { has_chapter_map?: boolean; chapter_count?: number }).has_chapter_map
            ? `✓ ${(doc as { chapter_count?: number }).chapter_count ?? '?'} chapters`
            : '✗ Not extracted'
        } />
        <Row label="Uploaded" value={new Date(doc.created_at ?? '').toLocaleString()} />
      </div>

      {quality?.signal_breakdown && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 mt-4 text-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium">Quality breakdown</span>
            <button
              onClick={() => rescore.mutate({ college_id: collegeId, doc_id: doc._id })}
              disabled={rescore.isPending}
              className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-3 py-1 rounded"
            >
              {rescore.isPending ? 'Re-scoring…' : 'Re-score'}
            </button>
          </div>
          <SignalRow label="Text density" value={quality.signal_breakdown.density} />
          <SignalRow label="OCR confidence" value={quality.signal_breakdown.ocr_confidence} na={!doc.ocr_used} />
          <SignalRow label="Structural integrity" value={quality.signal_breakdown.structural_integrity} />
          <SignalRow label="Vocabulary validity" value={quality.signal_breakdown.vocab_validity} />
          <SignalRow label="Boilerplate penalty" value={quality.signal_breakdown.boilerplate_penalty} />
          {quality.recommendations.length > 0 && (
            <div className="mt-3 text-xs text-amber-400 space-y-1">
              {quality.recommendations.map((r, i) => <p key={i}>⚠️ {r}</p>)}
            </div>
          )}
          {rescore.isError && <p className="mt-2 text-xs text-red-400">{rescore.error.message}</p>}
        </div>
      )}
      {quality?.quality_rescoring_needed && !quality.signal_breakdown && (
        <p className="mt-4 text-xs text-amber-400">
          ⚠️ This document was ingested before the quality scoring update — re-ingest to get a full breakdown.
        </p>
      )}

      {((doc as any).download_url) && (
        <a
          href={((doc as any).download_url)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm text-blue-400 hover:underline"
        >
          Download original
        </a>
      )}

      <div className="flex gap-3 mt-6 flex-wrap">
        <button
          onClick={() => reingest.mutate({ college_id: collegeId, doc_id: doc._id })}
          disabled={reingest.isPending}
          className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-4 py-2 rounded text-sm"
        >
          {reingest.isPending ? 'Queuing…' : 'Re-ingest'}
        </button>

        {(doc as { file_type?: string }).file_type === 'pdf' && (
          <button
            onClick={() => extractChapters.mutate({ college_id: collegeId, doc_id: doc._id })}
            disabled={extractChapters.isPending}
            className="bg-teal-800 hover:bg-teal-700 disabled:opacity-50 px-4 py-2 rounded text-sm text-teal-100"
          >
            {extractChapters.isPending
              ? 'Queuing…'
              : extractChapters.isSuccess
                ? '✓ Queued'
                : 'Extract Chapters'}
          </button>
        )}

        <button
          onClick={() => deleteMut.mutate({ college_id: collegeId, doc_id: doc._id })}
          disabled={deleteMut.isPending}
          className="bg-red-900/40 hover:bg-red-900/60 border border-red-700 disabled:opacity-50 px-4 py-2 rounded text-sm text-red-300"
        >
          Delete document
        </button>
      </div>

      {extractChapters.isError && (
        <p className="mt-2 text-xs text-red-400">{extractChapters.error.message}</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 w-32 shrink-0">{label}</span>
      <span className="text-gray-100">{value}</span>
    </div>
  );
}

function SignalRow({ label, value, na }: { label: string; value: number; na?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-gray-400 w-40 shrink-0">{label}</span>
      {na ? (
        <span className="text-gray-500 text-xs">N/A</span>
      ) : (
        <>
          <div className="flex-1 h-2 bg-gray-700 rounded overflow-hidden">
            <div
              className={pct < 60 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-gray-300 text-xs w-10 text-right">{value.toFixed(2)}</span>
        </>
      )}
    </div>
  );
}
