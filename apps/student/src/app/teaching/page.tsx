'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { AppShell } from '@/components/AppSidebar';
import { trpc } from '@/lib/trpc';

export default function TeachingBrowserPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { token } = useAuthStore();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.replace('/login');
  }, [mounted, token, router]);

  if (!mounted || !token) return null;

  return (
    <AppShell>
      <ConceptBrowser />
    </AppShell>
  );
}

function ConceptBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useAuthStore();
  const [docId, setDocId] = useState<string>(searchParams.get('doc_id') ?? '');
  const [q, setQ] = useState('');
  const chapterFromChat = searchParams.get('chapter_index');
  const chapterIndex = chapterFromChat ? Number(chapterFromChat) : undefined;

  const { data, isLoading } = trpc.teaching.concepts.useQuery(
    { doc_id: docId || undefined, chapter_index: chapterIndex, q: q || undefined },
    { enabled: !!token },
  );

  const start = trpc.teaching.start.useMutation({
    onSuccess: (result) => router.push(`/teaching/${result.session_id}`),
  });

  const byChapter = useMemo(() => {
    const groups = new Map<number, any[]>();
    for (const c of data?.concepts ?? []) {
      const list = groups.get(c.chapter_index) ?? [];
      list.push(c);
      groups.set(c.chapter_index, list);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [data]);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Teach me</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pick a concept and I'll walk you through it — diagnose what you know, build it up in steps, and check your understanding as we go.
        </p>
      </div>

      {chapterIndex !== undefined && (
        <div className="flex items-center gap-2 text-xs text-teal-400 bg-teal-900/20 border border-teal-800/40 rounded-lg px-3 py-2">
          <span>Showing Chapter {chapterIndex} concepts</span>
          <button onClick={() => router.push('/teaching')} className="underline hover:no-underline">clear</button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search concepts…"
          className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-teal-700"
        />
        {data && data.documents.length > 1 && (
          <select
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200"
          >
            <option value="">All books</option>
            {data.documents.map((d) => (
              <option key={d._id} value={d._id}>{d.original_filename}</option>
            ))}
          </select>
        )}
      </div>

      {start.isError && <p className="text-sm text-red-400">{start.error.message}</p>}

      {isLoading && (
        <div className="flex items-center justify-center h-32">
          <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && byChapter.length === 0 && (
        <p className="text-sm text-gray-500 py-8 text-center">
          No concepts found yet — your department's books may still be processing.
        </p>
      )}

      <div className="space-y-6">
        {byChapter.map(([chapterIndex, concepts]) => (
          <div key={chapterIndex}>
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Chapter {chapterIndex}
            </h2>
            <div className="space-y-1.5">
              {concepts.map((c) => (
                <button
                  key={c._id}
                  onClick={() => start.mutate({ concept_id: c._id })}
                  disabled={start.isPending}
                  className="w-full flex items-center justify-between gap-3 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-lg px-4 py-3 text-left transition-colors disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-gray-200 truncate">{c.canonical_name}</p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{c.one_line_definition}</p>
                  </div>
                  <span className="shrink-0 text-xs text-teal-400 whitespace-nowrap">
                    {start.isPending && start.variables?.concept_id === c._id ? 'Starting…' : 'Teach me →'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
