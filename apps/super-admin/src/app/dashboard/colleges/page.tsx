'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-400',
  suspended: 'text-red-400',
  pending: 'text-yellow-400',
};

export default function CollegesPage() {
  const { token } = useAuthStore();
  const [page, setPage] = useState(1);

  const { data, isLoading } = trpc.college.list.useQuery(
    { page, limit: 20 },
    { enabled: !!token }
  );

  const { data: overview } = trpc.college.analyticsOverview.useQuery(
    undefined,
    { enabled: !!token }
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Colleges</h1>
        <Link
          href="/dashboard/colleges/new"
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm transition-colors"
        >
          + New College
        </Link>
      </div>

      {overview && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard label="Total" value={overview.total} />
          <StatCard label="Active" value={overview.active} />
          <StatCard label="Suspended" value={overview.suspended} />
        </div>
      )}

      {isLoading && <p className="text-gray-400 text-sm">Loading…</p>}

      <div className="space-y-2">
        {data?.colleges?.map((c: { _id: string; name: string; slug: string; type: string; status: string }) => (
          <Link
            key={c._id}
            href={`/dashboard/colleges/${c._id}`}
            className="block bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg px-4 py-3 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-gray-400">{c.slug} · {c.type}</p>
              </div>
              <span className={`text-xs ${STATUS_COLORS[c.status] ?? 'text-gray-400'}`}>
                {c.status}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {(data?.pages ?? 1) > 1 && (
        <div className="flex gap-2 mt-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="text-sm px-3 py-1 border border-gray-700 rounded disabled:opacity-40">Prev</button>
          <span className="text-sm text-gray-400 self-center">{page} / {data?.pages}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page >= (data?.pages ?? 1)}
            className="text-sm px-3 py-1 border border-gray-700 rounded disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
