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

interface DeptRow {
  dept_id: string;
  claude_tokens_month: number;
  claude_tokens_today: number;
  claude_requests_month: number;
  embed_tokens_month: number;
}

interface CollegeDrilldown {
  college_id: string;
  mongodb: Record<string, number> | null;
  disk_college: { used_gb: number } | null;
  dept_breakdown: DeptRow[];
}

export default function CollegeObservatoryPage() {
  const { collegeId } = useParams() as { collegeId: string };
  const { token } = useAuthStore();
  const [data, setData] = useState<CollegeDrilldown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/super-admin/observatory/college/${collegeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => { setData(d as CollegeDrilldown); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token, collegeId]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;

  const m = data?.mongodb;
  const depts = data?.dept_breakdown ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dashboard/observatory" className="text-gray-500 hover:text-white text-sm">← Observatory</Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold text-white truncate">{collegeId} — College Detail</h1>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/dashboard/observatory/college/${collegeId}/students`}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1.5 rounded transition-colors"
          >
            Student Usage →
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="MongoDB storage" value={`${(m?.storage_gb ?? 0).toFixed(2)} GB`} />
        <KPICard label="Documents" value={fmtK(m?.document_count ?? 0)} />
        <KPICard label="Disk usage" value={`${(data?.disk_college?.used_gb ?? 0).toFixed(1)} GB`} />
        <KPICard label="Departments" value={String(depts.length)} />
      </div>

      {/* Dept breakdown */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Department Breakdown — This Month</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                <th className="pb-2 text-left">Department</th>
                <th className="pb-2 text-right">Claude Tokens (month)</th>
                <th className="pb-2 text-right">Claude Tokens (today)</th>
                <th className="pb-2 text-right">Requests (month)</th>
                <th className="pb-2 text-right">Embed Tokens (month)</th>
                <th className="pb-2 text-right">Students</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {depts.sort((a, b) => b.claude_tokens_month - a.claude_tokens_month).map((d) => (
                <tr key={d.dept_id} className="hover:bg-gray-800/40">
                  <td className="py-2 text-white font-medium max-w-[160px] truncate">{d.dept_id}</td>
                  <td className="py-2 text-right text-gray-300 font-mono text-xs">{fmtK(d.claude_tokens_month)}</td>
                  <td className="py-2 text-right text-gray-400 font-mono text-xs">{fmtK(d.claude_tokens_today)}</td>
                  <td className="py-2 text-right text-gray-400 text-xs">{fmtK(d.claude_requests_month)}</td>
                  <td className="py-2 text-right text-gray-400 font-mono text-xs">{fmtK(d.embed_tokens_month)}</td>
                  <td className="py-2 text-right">
                    <Link
                      href={`/dashboard/observatory/college/${collegeId}/students?dept_id=${d.dept_id}`}
                      className="text-blue-400 hover:text-blue-300 text-xs"
                    >
                      Students →
                    </Link>
                  </td>
                  <td className="py-2 text-right">
                    <Link
                      href={`/dashboard/colleges/${collegeId}/depts/${d.dept_id}`}
                      className="text-gray-500 hover:text-gray-300 text-xs"
                    >
                      Dept →
                    </Link>
                  </td>
                </tr>
              ))}
              {depts.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-gray-600 text-sm">No usage data for this month</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-white mt-1">{value}</p>
    </div>
  );
}
