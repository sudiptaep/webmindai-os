'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];

function fmt$(n: number) { return `$${n.toFixed(2)}`; }
function fmtK(n: number) {
  return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n);
}

export default function DashboardPage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const [month, setMonth] = useState(defaultMonth);

  const { data, isLoading } = trpc.superAdminDashboard.getDashboard.useQuery({ month });
  const { data: truncation } = trpc.superAdminObservatory.truncationRate.useQuery({ days: 7 });

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>;

  const totals = data?.platform_totals;
  const colleges = (data?.cost_by_college ?? []) as Array<{ college_id: string; total_cost_usd: number; token_utilisation_pct: number; chat_message_count: number }>;
  const alerts = (data?.alerts ?? []) as Array<{ _id: string; severity: string; message: string }>;
  const dailyTrend = (data?.daily_trend ?? []).map((d: { _id: string; total: number }) => ({ day: d._id.slice(5), cost: d.total }));

  const serviceData = totals ? [
    { name: 'Anthropic', value: totals.anthropic_cost },
    { name: 'OpenAI', value: totals.openai_cost },
    { name: 'Cohere', value: totals.cohere_cost },
    { name: 'Pinecone', value: totals.pinecone_cost },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Platform Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">All colleges · third-party cost intelligence</p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
        >
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a._id} className={`flex items-start gap-2 px-4 py-3 rounded-lg border text-sm ${a.severity === 'critical' ? 'bg-red-100 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300' : 'bg-yellow-100 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300'}`}>
              <span>{a.severity === 'critical' ? '🔴' : '⚠️'}</span>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Cost" value={fmt$(totals?.total_cost_usd ?? 0)} sub="this month" />
        <KPICard label="LLM Tokens" value={fmtK(totals?.llm_tokens ?? 0)} sub="input + output" />
        <KPICard label="Active Students" value={fmtK(totals?.unique_students ?? 0)} sub={`${colleges.length} colleges`} />
        <KPICard label="Chat Messages" value={fmtK(totals?.chat_messages ?? 0)} sub="this month" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Cost by College</h2>
          <div className="space-y-1">
            {colleges.sort((a, b) => b.total_cost_usd - a.total_cost_usd).map((c) => (
              <Link key={c.college_id} href={`/dashboard/colleges/${c.college_id}/costs?month=${month}`}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted transition-colors group">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">{c.college_id}</p>
                  <p className="text-xs text-muted-foreground">{fmtK(c.chat_message_count ?? 0)} chats</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-mono text-foreground">{fmt$(c.total_cost_usd)}</p>
                    <p className={`text-xs ${c.token_utilisation_pct >= 90 ? 'text-destructive' : c.token_utilisation_pct >= 75 ? 'text-yellow-700 dark:text-yellow-400' : 'text-muted-foreground'}`}>
                      {(c.token_utilisation_pct ?? 0).toFixed(0)}% tokens
                    </p>
                  </div>
                  <span className="text-muted-foreground group-hover:text-muted-foreground text-sm">→</span>
                </div>
              </Link>
            ))}
            {colleges.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No cost data for this month</p>}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Cost by Service</h2>
          {serviceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={serviceData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                  {serviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt$(v ? Number(v) : 0)} />
                <Legend formatter={(v: string) => <span className="text-xs text-muted-foreground">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
          )}
        </div>
      </div>

      {truncation && truncation.by_college.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-foreground">Response Truncation Rate — last 7 days</h2>
            <span className={`text-lg font-bold ${truncation.platform_wide_pct > truncation.alert_threshold_pct ? 'text-destructive' : 'text-green-700 dark:text-green-400'}`}>
              {truncation.platform_wide_pct}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Target: &lt; {truncation.alert_threshold_pct}%</p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">By college</h3>
              <div className="space-y-1">
                {truncation.by_college.map((row) => (
                  <div key={row.college_id} className="flex items-center justify-between text-xs">
                    <span className="text-foreground truncate">{row.college_id}</span>
                    <span className={row.truncation_pct > truncation.alert_threshold_pct ? 'text-destructive' : 'text-muted-foreground'}>
                      {row.truncation_pct}% {row.truncation_pct > truncation.alert_threshold_pct ? '⚠' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">By question type</h3>
              <div className="space-y-1">
                {truncation.by_question_type.map((row) => (
                  <div key={row.query_complexity} className="flex items-center justify-between text-xs">
                    <span className="text-foreground">{row.query_complexity}</span>
                    <span className="text-muted-foreground">{row.truncation_pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {dailyTrend.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Daily Cost Trend — {month}</h2>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dailyTrend}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => `$${v.toFixed(3)}`} />
              <Tooltip formatter={(v) => [fmt$(v ? Number(v) : 0), 'Cost']} />
              <Bar dataKey="cost" fill="#3b82f6" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function KPICard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}
