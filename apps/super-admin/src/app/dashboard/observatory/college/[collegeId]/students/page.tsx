'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

const API = process.env.NEXT_PUBLIC_API_URL!;

function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n ?? 0));
}

function fmt$(n: number) { return `$${(n ?? 0).toFixed(4)}`; }

interface StudentRow {
  student_id: string;
  dept_id: string;
  name: string;
  email: string;
  semester: number;
  total_tokens: number;
  total_cost_usd: number;
  chat_count: number;
  ai_summary_count: number;
  exam_gen_count: number;
  active_day_count: number;
  last_active_at: string;
  tokens_vs_dept_avg: number;
}

interface StudentsResponse {
  college_id: string;
  billing_month: string;
  students: StudentRow[];
  total: number;
  page: number;
  limit: number;
}

export default function StudentObservatoryPage() {
  const { collegeId } = useParams() as { collegeId: string };
  const searchParams = useSearchParams();
  const { token } = useAuthStore();

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [month, setMonth] = useState(defaultMonth);
  const [deptFilter, setDeptFilter] = useState(searchParams.get('dept_id') ?? '');
  const [sort, setSort] = useState('tokens_desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StudentsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);

    const params = new URLSearchParams({
      billing_month: month,
      sort,
      page: String(page),
      limit: '50',
    });
    if (deptFilter) params.set('dept_id', deptFilter);

    fetch(`${API}/api/v1/super-admin/observatory/college/${collegeId}/students?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => { setData(d as StudentsResponse); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token, collegeId, month, sort, page, deptFilter]);

  const students = data?.students ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  function vsAvgColor(ratio: number) {
    if (ratio >= 2) return 'text-destructive';
    if (ratio >= 1.5) return 'text-yellow-700 dark:text-yellow-400';
    if (ratio >= 0.5) return 'text-foreground';
    return 'text-muted-foreground';
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/dashboard/observatory/college/${collegeId}`} className="text-muted-foreground hover:text-white text-sm">
          ← College Detail
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-xl font-bold text-white">Student Usage Observatory</h1>
        <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">{collegeId}</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Month</label>
          <select
            value={month}
            onChange={(e) => { setMonth(e.target.value); setPage(1); }}
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
          >
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Department</label>
          <input
            type="text"
            placeholder="All depts"
            value={deptFilter}
            onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none w-40"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Sort by</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
          >
            <option value="tokens_desc">Tokens (high → low)</option>
            <option value="tokens_asc">Tokens (low → high)</option>
            <option value="cost_desc">Cost (high → low)</option>
            <option value="active_days_desc">Active days</option>
            <option value="last_active">Last active</option>
          </select>
        </div>
        <div className="text-xs text-muted-foreground self-end pb-2">
          {total} students
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl p-5">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground uppercase border-b border-border">
                  <th className="pb-2 text-left">Student</th>
                  <th className="pb-2 text-left">Dept</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Chats</th>
                  <th className="pb-2 text-right">Summaries</th>
                  <th className="pb-2 text-right">Exams</th>
                  <th className="pb-2 text-right">Active days</th>
                  <th className="pb-2 text-right">vs dept avg</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {students.map((s) => (
                  <tr key={s.student_id} className="hover:bg-muted/40">
                    <td className="py-2">
                      <p className="text-white font-medium">{s.name || '—'}</p>
                      <p className="text-muted-foreground text-xs">{s.email}</p>
                    </td>
                    <td className="py-2 text-muted-foreground text-xs max-w-[120px] truncate">{s.dept_id}</td>
                    <td className="py-2 text-right text-foreground font-mono text-xs">{fmtK(s.total_tokens)}</td>
                    <td className="py-2 text-right text-foreground font-mono text-xs">{fmt$(s.total_cost_usd)}</td>
                    <td className="py-2 text-right text-muted-foreground text-xs">{s.chat_count}</td>
                    <td className="py-2 text-right text-muted-foreground text-xs">{s.ai_summary_count}</td>
                    <td className="py-2 text-right text-muted-foreground text-xs">{s.exam_gen_count}</td>
                    <td className="py-2 text-right text-muted-foreground text-xs">{s.active_day_count}</td>
                    <td className={`py-2 text-right font-mono text-xs ${vsAvgColor(s.tokens_vs_dept_avg)}`}>
                      {s.tokens_vs_dept_avg > 0 ? `${s.tokens_vs_dept_avg.toFixed(1)}×` : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/dashboard/observatory/college/${collegeId}/students/${s.student_id}`}
                        className="text-primary hover:text-blue-300 text-xs"
                      >
                        Profile →
                      </Link>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-muted-foreground text-sm">
                      No student activity for {month}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-xs text-muted-foreground hover:text-white disabled:opacity-30 transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-xs text-muted-foreground hover:text-white disabled:opacity-30 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
