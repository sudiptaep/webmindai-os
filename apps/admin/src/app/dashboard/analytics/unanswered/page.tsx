'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

const LIMIT = 20;

export default function UnansweredPage() {
  const router = useRouter();
  const { token, user } = useAuthStore();
  const deptId = user?.dept_id ?? '';
  const [page, setPage] = useState(1);

  const { data, refetch } = trpc.analytics.unansweredQueue.useQuery(
    { dept_id: deptId, page, limit: LIMIT },
    { enabled: !!deptId && !!token }
  );

  const ack = trpc.analytics.acknowledgeQuery.useMutation({ onSuccess: () => refetch() });
  const totalPages = data ? Math.ceil(data.total / LIMIT) : 1;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.back()}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </button>
        <h1 className="text-xl font-semibold">Unanswered Queries</h1>
      </div>

      <div className="space-y-2">
        {data?.queries?.map((q) => (
          <div
            key={q._id}
            className="bg-muted border border-border rounded-lg px-4 py-3 flex items-center gap-4"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{q.query_text}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(q.created_at).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => ack.mutate({ query_id: q._id })}
              className="text-xs text-green-700 dark:text-green-400 hover:text-green-700 dark:text-green-300 px-2 py-1 border border-green-800 rounded shrink-0"
            >
              Acknowledge
            </button>
          </div>
        ))}
      </div>

      {data?.queries?.length === 0 && (
        <p className="text-muted-foreground text-sm">No unanswered queries.</p>
      )}

      {totalPages > 1 && (
        <div className="flex gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="text-sm px-3 py-1 border border-border rounded disabled:opacity-40">Prev</button>
          <span className="text-sm text-muted-foreground self-center">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}
            className="text-sm px-3 py-1 border border-border rounded disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
