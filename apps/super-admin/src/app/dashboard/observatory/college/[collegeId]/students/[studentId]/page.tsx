'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

const API = process.env.NEXT_PUBLIC_API_URL!;

function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n ?? 0));
}

interface StudentProfile {
  student_id: string;
  college_id: string;
  billing_month: string;
  profile: { name: string; email: string; semester: number; roll_number?: string } | null;
  monthly_summary: {
    dept_id: string;
    total_tokens: number;
    total_cost_usd: number;
    total_requests: number;
    active_day_count: number;
    last_active_at: string;
    tokens_vs_dept_avg: number;
    dept_avg_tokens: number;
    percentile_rank_in_dept: number | null;
    total_students_in_dept: number;
  } | null;
  daily_trend: Array<{ date: string; tokens: number; requests: number; cost_usd: number }>;
  action_breakdown: Array<{ action_type: string; tokens: number; count: number; cost_usd: number }>;
  hourly_distribution: Array<{ hour: number; requests: number; tokens: number }>;
}

const ACTION_LABELS: Record<string, string> = {
  chat_message: 'Chat messages',
  ai_summary: 'AI summaries',
  exam_generation: 'Exam generation',
  query_embedding: 'Query embeddings',
  doc_ingestion: 'Doc ingestion',
};

export default function StudentProfilePage() {
  const { collegeId, studentId } = useParams() as { collegeId: string; studentId: string };
  const { token } = useAuthStore();
  const [data, setData] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/super-admin/observatory/college/${collegeId}/students/${studentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => { setData(d as StudentProfile); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token, collegeId, studentId]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;
  if (!data) return <div className="flex items-center justify-center h-64 text-red-400">Failed to load student profile</div>;

  const summary = data.monthly_summary;
  const profile = data.profile;

  // Compute max for bar chart normalization
  const maxDailyTokens = Math.max(...data.daily_trend.map((d) => d.tokens), 1);
  const maxHourlyReqs = Math.max(...data.hourly_distribution.map((h) => h.requests), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/dashboard/observatory/college/${collegeId}/students`} className="text-gray-500 hover:text-white text-sm">
          ← Students
        </Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold text-white truncate">
          {profile?.name ?? studentId}
        </h1>
        <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">
          {data.billing_month}
        </span>
      </div>

      {/* Profile + summary KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Profile card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Profile</h2>
          <p className="text-white font-semibold text-lg">{profile?.name ?? '—'}</p>
          <p className="text-gray-400 text-sm">{profile?.email ?? studentId}</p>
          <div className="text-xs text-gray-500 space-y-1 pt-2 border-t border-gray-800">
            <p>Semester: <span className="text-gray-300">{profile?.semester ?? '—'}</span></p>
            {profile?.roll_number && <p>Roll No: <span className="text-gray-300">{profile.roll_number}</span></p>}
            <p>Department: <span className="text-gray-300 truncate">{summary?.dept_id ?? '—'}</span></p>
            {summary?.last_active_at && (
              <p>Last active: <span className="text-gray-300">{new Date(summary.last_active_at).toLocaleDateString()}</span></p>
            )}
          </div>
        </div>

        {/* Monthly stats */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KPICard label="Total tokens" value={fmtK(summary?.total_tokens ?? 0)} />
          <KPICard label="Total cost" value={`$${(summary?.total_cost_usd ?? 0).toFixed(4)}`} />
          <KPICard label="Active days" value={String(summary?.active_day_count ?? 0)} />
          <KPICard label="Total requests" value={fmtK(summary?.total_requests ?? 0)} />
          <KPICard
            label="vs dept avg"
            value={summary?.tokens_vs_dept_avg != null ? `${summary.tokens_vs_dept_avg.toFixed(1)}×` : '—'}
            highlight={
              (summary?.tokens_vs_dept_avg ?? 1) >= 2 ? 'red' :
              (summary?.tokens_vs_dept_avg ?? 1) >= 1.5 ? 'yellow' : 'normal'
            }
          />
          <KPICard
            label="Dept rank"
            value={summary?.percentile_rank_in_dept != null ? `${summary.percentile_rank_in_dept}th %ile` : '—'}
            sub={summary?.total_students_in_dept ? `of ${summary.total_students_in_dept} students` : undefined}
          />
        </div>
      </div>

      {/* Action breakdown */}
      {data.action_breakdown.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Action Breakdown — {data.billing_month}</h2>
          <div className="space-y-2">
            {data.action_breakdown
              .sort((a, b) => b.tokens - a.tokens)
              .map((row) => {
                const totalTokens = summary?.total_tokens ?? 1;
                const pct = Math.round((row.tokens / totalTokens) * 100);
                return (
                  <div key={row.action_type} className="grid grid-cols-12 items-center gap-3 text-sm">
                    <span className="col-span-3 text-gray-400 text-xs">{ACTION_LABELS[row.action_type] ?? row.action_type}</span>
                    <div className="col-span-5 h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-600 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="col-span-1 text-xs text-gray-500">{pct}%</span>
                    <span className="col-span-2 text-right text-gray-300 font-mono text-xs">{fmtK(row.tokens)}</span>
                    <span className="col-span-1 text-right text-gray-500 text-xs">{row.count}×</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 30-day daily trend */}
      {data.daily_trend.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Daily Token Usage — Last 30 Days</h2>
          <div className="flex items-end gap-0.5 h-24">
            {data.daily_trend.map((d) => {
              const h = Math.max(4, Math.round((d.tokens / maxDailyTokens) * 96));
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${fmtK(d.tokens)} tokens, ${d.requests} requests`}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 rounded-t transition-colors cursor-default"
                  style={{ height: `${h}px` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-600 mt-1">
            <span>{data.daily_trend[0]?.date?.slice(5)}</span>
            <span>{data.daily_trend[Math.floor(data.daily_trend.length / 2)]?.date?.slice(5)}</span>
            <span>{data.daily_trend[data.daily_trend.length - 1]?.date?.slice(5)}</span>
          </div>
        </div>
      )}

      {/* 24h activity heatmap */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">24h Activity Pattern — Last 30 Days</h2>
        <div className="flex items-end gap-1 h-16">
          {data.hourly_distribution.map((h) => {
            const height = Math.max(4, Math.round((h.requests / maxHourlyReqs) * 64));
            const isActive = h.requests > 0;
            return (
              <div key={h.hour} className="flex-1 flex flex-col items-center gap-1">
                <div
                  title={`${h.hour}:00 — ${h.requests} requests`}
                  className={`w-full rounded-t transition-colors cursor-default ${isActive ? 'bg-purple-600 hover:bg-purple-500' : 'bg-gray-800'}`}
                  style={{ height: `${height}px` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-xs text-gray-600 mt-1">
          {[0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) => (
            <span key={h}>{String(h).padStart(2, '0')}h</span>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-2">
          Peak hours: {data.hourly_distribution
            .sort((a, b) => b.requests - a.requests)
            .slice(0, 3)
            .map((h) => `${String(h.hour).padStart(2, '0')}:00`)
            .join(', ')}
        </p>
      </div>
    </div>
  );
}

function KPICard({
  label, value, sub, highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: 'red' | 'yellow' | 'normal';
}) {
  const valueColor =
    highlight === 'red' ? 'text-red-400' :
    highlight === 'yellow' ? 'text-yellow-400' :
    'text-white';
  return (
    <div className="bg-gray-950/50 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}
