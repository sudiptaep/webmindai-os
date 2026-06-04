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

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;

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
          <h1 className="text-xl font-bold text-white">Platform Overview</h1>
          <p className="text-sm text-gray-400 mt-0.5">All colleges · third-party cost intelligence</p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a._id} className={`flex items-start gap-2 px-4 py-3 rounded-lg border text-sm ${a.severity === 'critical' ? 'bg-red-950/30 border-red-800 text-red-300' : 'bg-yellow-950/30 border-yellow-800 text-yellow-300'}`}>
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
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Cost by College</h2>
          <div className="space-y-1">
            {colleges.sort((a, b) => b.total_cost_usd - a.total_cost_usd).map((c) => (
              <Link key={c.college_id} href={`/dashboard/colleges/${c.college_id}/costs?month=${month}`}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors group">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{c.college_id}</p>
                  <p className="text-xs text-gray-500">{fmtK(c.chat_message_count ?? 0)} chats</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-mono text-white">{fmt$(c.total_cost_usd)}</p>
                    <p className={`text-xs ${c.token_utilisation_pct >= 90 ? 'text-red-400' : c.token_utilisation_pct >= 75 ? 'text-yellow-400' : 'text-gray-500'}`}>
                      {(c.token_utilisation_pct ?? 0).toFixed(0)}% tokens
                    </p>
                  </div>
                  <span className="text-gray-600 group-hover:text-gray-400 text-sm">→</span>
                </div>
              </Link>
            ))}
            {colleges.length === 0 && <p className="text-sm text-gray-600 text-center py-6">No cost data for this month</p>}
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Cost by Service</h2>
          {serviceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={serviceData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                  {serviceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt$(v)} />
                <Legend formatter={(v: string) => <span className="text-xs text-gray-400">{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data yet</div>
          )}
        </div>
      </div>

      {dailyTrend.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Daily Cost Trend — {month}</h2>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dailyTrend}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => `$${v.toFixed(3)}`} />
              <Tooltip formatter={(v: number) => [fmt$(v), 'Cost']} />
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}
