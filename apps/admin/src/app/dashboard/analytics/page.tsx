'use client';

import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';
import Link from 'next/link';

export default function AnalyticsPage() {
  const { token, user } = useAuthStore();
  const collegeId = user?.college_id ?? '';
  const deptId = user?.dept_ids?.[0] ?? '';

  const { data: stats } = trpc.analytics.collegeStats.useQuery(
    { college_id: collegeId },
    { enabled: !!collegeId && !!token }
  );

  const { data: volume } = trpc.analytics.queryVolume.useQuery(
    { dept_id: deptId, days: 7 },
    { enabled: !!deptId && !!token }
  );

  const { data: topics } = trpc.analytics.topics.useQuery(
    { dept_id: deptId, hours: 24 },
    { enabled: !!deptId && !!token }
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <Link
          href="/dashboard/analytics/unanswered"
          className="text-sm bg-amber-700 hover:bg-amber-600 px-3 py-1.5 rounded transition-colors"
        >
          Unanswered Queue
        </Link>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard
            label="Total queries"
            value={stats.total_queries}
          />
          <StatCard
            label="Answer rate"
            value={`${Math.round((stats.answer_rate ?? 0) * 100)}%`}
          />
          <StatCard
            label="Active students"
            value={stats.total_students}
          />
        </div>
      )}

      {/* Query volume last 7d */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">
        <h2 className="text-sm font-medium mb-3 text-gray-300">Query volume — last 7 days</h2>
        {volume?.length === 0 && <p className="text-gray-500 text-xs">No data yet.</p>}
        <div className="space-y-1">
          {volume?.map((row: { date: string; total: number; answered: number; unanswered: number }) => (
            <div key={row.date} className="flex items-center gap-3 text-xs">
              <span className="text-gray-400 w-20 shrink-0">{row.date}</span>
              <div className="flex-1 bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 rounded-full h-2"
                  style={{ width: `${Math.min(100, (row.answered / Math.max(row.total, 1)) * 100)}%` }}
                />
              </div>
              <span className="text-gray-300 w-8 text-right">{row.total}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trending topics */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <h2 className="text-sm font-medium mb-3 text-gray-300">Trending topics — last 24h</h2>
        {topics?.length === 0 && <p className="text-gray-500 text-xs">No topics yet.</p>}
        <div className="space-y-2">
          {topics?.slice(0, 10).map((t: { query_text: string; count: number; first_seen: string }, i: number) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="text-gray-400 w-5">{i + 1}.</span>
              <span className="flex-1 truncate text-gray-100">{t.query_text}</span>
              <span className="text-gray-400">{t.count}×</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
