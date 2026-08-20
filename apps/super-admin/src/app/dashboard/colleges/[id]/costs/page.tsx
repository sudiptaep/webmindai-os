'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
const API = process.env.NEXT_PUBLIC_API_URL!;

function fmt$(n: number) { return `$${(n ?? 0).toFixed(4)}`; }
function fmtK(n: number) { return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n ?? 0); }

export default function CollegeCostPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const collegeId = params.id as string;

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const [month, setMonth] = useState(searchParams.get('month') ?? defaultMonth);

  const { data, isLoading } = trpc.superAdminDashboard.getCollegeCosts.useQuery({ collegeId, month });

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  async function exportCsv() {
    const res = await fetch(`${API}/api/v1/super-admin/colleges/${collegeId}/costs/export?month=${month}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('super-admin-token')}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `costs-${collegeId}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>;

  const totals = data?.totals;
  const byDept = (data?.by_dept ?? []) as Array<{ dept_id: string; total_cost_usd: number; llm_input_tokens: number; llm_output_tokens: number; chat_message_count: number; token_utilisation_pct: number }>;
  const dailyTrend = (data?.daily_trend ?? []).map((d: { _id: string; total: number }) => ({ day: d._id.slice(5), cost: d.total }));
  const margin = data?.margin as { revenue_inr: number; cost_usd: number; cost_inr: number; margin_inr: number; margin_pct: number; cost_revenue_pct: number; status: string } | undefined;
  const policy = data?.policy as { llm_token_limit_per_month: number; cost_budget_usd_per_month: number; allowed_llm_models: string[]; max_chat_queries_per_student_per_day: number; storage_limit_gb: number } | undefined;

  const serviceData = totals ? [
    { name: 'Anthropic', value: (totals as { anthropic_cost_usd: number }).anthropic_cost_usd },
    { name: 'OpenAI', value: (totals as { openai_cost_usd: number }).openai_cost_usd },
    { name: 'Cohere', value: (totals as { cohere_cost_usd: number }).cohere_cost_usd },
    { name: 'Pinecone', value: (totals as { pinecone_cost_usd: number }).pinecone_cost_usd },
  ].filter(d => d.value > 0) : [];

  const tokenUtil = (totals as { token_utilisation_pct?: number })?.token_utilisation_pct ?? 0;
  const costUtil = (totals as { cost_utilisation_pct?: number })?.cost_utilisation_pct ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dashboard" className="text-muted-foreground hover:text-white text-sm transition-colors">← Platform Overview</Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-xl font-bold text-white truncate">{collegeId} — Cost Detail</h1>
        <div className="ml-auto flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)}
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none">
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={exportCsv} className="bg-muted hover:bg-accent border border-border rounded-lg px-3 py-1.5 text-sm text-white transition-colors">Export CSV</button>
          <Link href={`/dashboard/colleges/${collegeId}/policy`} className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-3 py-1.5 text-sm text-white transition-colors">Edit Policy</Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Cost" value={`$${((totals as { total_cost_usd?: number })?.total_cost_usd ?? 0).toFixed(4)}`} sub={`limit: $${policy?.cost_budget_usd_per_month ?? '—'}`} pct={costUtil} />
        <KPICard label="Token Usage" value={fmtK(((totals as { llm_input_tokens?: number })?.llm_input_tokens ?? 0) + ((totals as { llm_output_tokens?: number })?.llm_output_tokens ?? 0))} sub={`limit: ${fmtK(policy?.llm_token_limit_per_month ?? 0)}`} pct={tokenUtil} />
        <KPICard label="Budget Used" value={`${costUtil.toFixed(1)}%`} sub={`of $${policy?.cost_budget_usd_per_month ?? 0}/mo`} pct={costUtil} />
        <KPICard label="Chat Messages" value={fmtK((totals as { chat_message_count?: number })?.chat_message_count ?? 0)} sub="this month" />
      </div>

      {/* Dept breakdown + service donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Cost by Department</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-muted-foreground uppercase border-b border-border">
                <th className="pb-2 text-left">Department</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2 text-right">Cost USD</th>
                <th className="pb-2 text-right">Chats</th>
                <th className="pb-2"></th>
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {byDept.sort((a, b) => b.total_cost_usd - a.total_cost_usd).map((d) => (
                  <tr key={d.dept_id} className="hover:bg-muted/50">
                    <td className="py-2 text-white font-medium truncate max-w-[140px]">{d.dept_id}</td>
                    <td className="py-2 text-right text-foreground font-mono text-xs">{fmtK((d.llm_input_tokens ?? 0) + (d.llm_output_tokens ?? 0))}</td>
                    <td className="py-2 text-right text-foreground font-mono text-xs">{fmt$(d.total_cost_usd)}</td>
                    <td className="py-2 text-right text-muted-foreground text-xs">{fmtK(d.chat_message_count ?? 0)}</td>
                    <td className="py-2 text-right">
                      <Link href={`/dashboard/colleges/${collegeId}/depts/${d.dept_id}/costs?month=${month}`} className="text-primary hover:text-blue-300 text-xs">→</Link>
                    </td>
                  </tr>
                ))}
                {byDept.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground text-sm">No dept data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Cost by Service</h2>
          {serviceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={serviceData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                  {serviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => v !== undefined && v !== null ? `$${Number(v).toFixed(4)}` : ''} />

                <Legend formatter={(v: string) => <span className="text-xs text-muted-foreground">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">No data</div>}

          {/* Margin */}
          {margin && (
            <div className={`mt-4 p-3 rounded-lg border text-xs ${margin.status === 'danger' ? 'bg-red-100 dark:bg-red-950/30 border-red-300 dark:border-red-800' : margin.status === 'warn' ? 'bg-yellow-100 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-800' : 'bg-green-100 dark:bg-green-950/30 border-green-800'}`}>
              <p className="text-muted-foreground">Revenue: ₹{margin.revenue_inr.toFixed(0)}</p>
              <p className="text-muted-foreground">Cost: ₹{margin.cost_inr.toFixed(0)} (${margin.cost_usd.toFixed(4)})</p>
              <p className={`font-semibold mt-1 ${margin.status === 'danger' ? 'text-red-300' : margin.status === 'warn' ? 'text-yellow-300' : 'text-green-700 dark:text-green-300'}`}>
                Margin: ₹{margin.margin_inr.toFixed(0)} ({margin.margin_pct.toFixed(1)}%)
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Daily trend */}
      {dailyTrend.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Daily Cost — {month}</h2>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={dailyTrend}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => `$${v.toFixed(3)}`} />
                <Tooltip formatter={(v: any) => v !== undefined && v !== null ? `$${Number(v).toFixed(4)}` : ''} />
              <Bar dataKey="cost" fill="#3b82f6" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Policy summary */}
      {policy && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Policy in Effect</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <PolicyRow label="Token limit" value={fmtK(policy.llm_token_limit_per_month) + '/mo'} />
            <PolicyRow label="Budget ceiling" value={`$${policy.cost_budget_usd_per_month}/mo`} />
            <PolicyRow label="Models" value={policy.allowed_llm_models?.join(', ') ?? '—'} />
            <PolicyRow label="Student limit" value={`${policy.max_chat_queries_per_student_per_day} chats/day`} />
            <PolicyRow label="Storage limit" value={`${policy.storage_limit_gb} GB`} />
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({ label, value, sub, pct }: { label: string; value: string; sub: string; pct?: number }) {
  const color = (pct ?? 0) >= 90 ? 'bg-red-500' : (pct ?? 0) >= 75 ? 'bg-yellow-500' : 'bg-blue-500';
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-white mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      {pct !== undefined && (
        <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div><span className="text-muted-foreground">{label}: </span><span className="text-foreground">{value}</span></div>
  );
}
