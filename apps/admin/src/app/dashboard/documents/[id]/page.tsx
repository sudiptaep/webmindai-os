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

  const { data: concepts, refetch: refetchConcepts } = trpc.conceptGraph.list.useQuery(
    { doc_id: params.id },
    { enabled: !!collegeId && !!token && !!doc?.has_chapter_map }
  );
  const { data: validation } = trpc.conceptGraph.validate.useQuery(
    { doc_id: params.id },
    { enabled: !!collegeId && !!token && !!concepts?.length }
  );

  const reingest        = trpc.document.reingest.useMutation();
  const extractChapters = trpc.document.extractChapters.useMutation();
  const extractConcepts = trpc.conceptGraph.extract.useMutation({
    onSuccess: () => refetchConcepts(),
  });
  const rescore         = trpc.document.rescore.useMutation({
    onSuccess: () => refetchQuality(),
  });
  const deleteMut       = trpc.document.delete.useMutation({
    onSuccess: () => router.push('/dashboard/documents'),
  });

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!doc) return <p className="text-muted-foreground text-sm">Document not found.</p>;

  return (
    <div className="max-w-2xl">
      <button
        onClick={() => router.back()}
        className="text-sm text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1"
      >
        ← Back
      </button>
      <h1 className="text-xl font-semibold mb-6 break-all">{doc.original_filename}</h1>

      <div className="bg-muted border border-border rounded-lg p-5 space-y-3 text-sm">
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
        <div className="bg-muted border border-border rounded-lg p-5 mt-4 text-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium">Quality breakdown</span>
            <button
              onClick={() => rescore.mutate({ college_id: collegeId, doc_id: doc._id })}
              disabled={rescore.isPending}
              className="text-xs bg-accent hover:bg-accent disabled:opacity-50 px-3 py-1 rounded"
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
            <div className="mt-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              {quality.recommendations.map((r, i) => <p key={i}>⚠️ {r}</p>)}
            </div>
          )}
          {rescore.isError && <p className="mt-2 text-xs text-destructive">{rescore.error.message}</p>}
        </div>
      )}
      {quality?.quality_rescoring_needed && !quality.signal_breakdown && (
        <p className="mt-4 text-xs text-amber-700 dark:text-amber-400">
          ⚠️ This document was ingested before the quality scoring update — re-ingest to get a full breakdown.
        </p>
      )}

      {(doc as { has_chapter_map?: boolean }).has_chapter_map && (
        <div className="bg-muted border border-border rounded-lg p-5 mt-4 text-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium">
              Concept graph {concepts ? `· ${concepts.length} concepts` : ''}
            </span>
            <button
              onClick={() => extractConcepts.mutate({ doc_id: doc._id })}
              disabled={extractConcepts.isPending}
              className="text-xs bg-accent hover:bg-accent disabled:opacity-50 px-3 py-1 rounded"
            >
              {extractConcepts.isPending
                ? 'Queuing…'
                : concepts?.length
                  ? 'Re-extract'
                  : 'Extract concept graph'}
            </button>
          </div>

          {extractConcepts.isError && (
            <p className="text-xs text-destructive mb-2">{extractConcepts.error.message}</p>
          )}

          {validation && (validation.cycles.length > 0 || validation.suspicious_edges.length > 0) && (
            <div className="mb-3 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              {validation.cycles.map((cycle, i) => (
                <p key={`cycle-${i}`}>⚠ Cycle detected: {cycle.join(' → ')}</p>
              ))}
              {validation.suspicious_edges.map((e, i) => (
                <p key={`edge-${i}`}>
                  ⚠ "{e.canonical_name}" depends on "{e.prerequisite_name}" from a later chapter — review suggested
                </p>
              ))}
            </div>
          )}

          {concepts && concepts.length > 0 && (
            <div className="max-h-80 overflow-y-auto space-y-1">
              {concepts.map((c) => (
                <div key={c._id} className="flex items-start gap-2 py-1 border-b border-border/50 last:border-0">
                  <span className="text-muted-foreground text-xs w-10 shrink-0">Ch.{c.chapter_index}</span>
                  <span className="flex-1">
                    {c.canonical_name}
                    {c.prerequisite_names.length > 0 && (
                      <span className="text-muted-foreground text-xs"> ← {c.prerequisite_names.join(', ')}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs shrink-0">{c.concept_type}</span>
                </div>
              ))}
            </div>
          )}
          {concepts && concepts.length === 0 && !extractConcepts.isPending && (
            <p className="text-xs text-muted-foreground">No concepts extracted yet.</p>
          )}
        </div>
      )}

      {((doc as any).download_url) && (
        <a
          href={((doc as any).download_url)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          Download original
        </a>
      )}

      <div className="flex gap-3 mt-6 flex-wrap">
        <button
          onClick={() => reingest.mutate({ college_id: collegeId, doc_id: doc._id })}
          disabled={reingest.isPending}
          className="bg-accent hover:bg-accent disabled:opacity-50 px-4 py-2 rounded text-sm"
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
          className="bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 border border-red-300 dark:border-red-700 disabled:opacity-50 px-4 py-2 rounded text-sm text-red-700 dark:text-red-300"
        >
          Delete document
        </button>
      </div>

      {extractChapters.isError && (
        <p className="mt-2 text-xs text-destructive">{extractChapters.error.message}</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function SignalRow({ label, value, na }: { label: string; value: number; na?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-muted-foreground w-40 shrink-0">{label}</span>
      {na ? (
        <span className="text-muted-foreground text-xs">N/A</span>
      ) : (
        <>
          <div className="flex-1 h-2 bg-accent rounded overflow-hidden">
            <div
              className={pct < 60 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-foreground text-xs w-10 text-right">{value.toFixed(2)}</span>
        </>
      )}
    </div>
  );
}
