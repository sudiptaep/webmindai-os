'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function fmt$(n: number) { return `$${(n ?? 0).toFixed(4)}`; }
function fmtK(n: number) { return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n ?? 0); }

const ACTION_LABELS: Record<string, string> = {
  chat_message: 'Chat',
  query_embedding: 'Query Embed',
  doc_ingestion: 'Doc Ingest',
  exam_generation: 'Exam Gen',
  pinecone_read: 'Pinecone Read',
  pinecone_write: 'Pinecone Write',
};

const SERVICE_COLORS: Record<string, string> = {
  anthropic: '#8b5cf6',
  openai_embeddings: '#10b981',
  pinecone: '#f59e0b',
  cohere: '#3b82f6',
};

export default function DeptCostPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const collegeId = params.id as string;
  const deptId = params.deptId as string;

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const [month, setMonth] = useState(searchParams.get('month') ?? defaultMonth);

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });

  const { data, isLoading } = trpc.superAdminDashboard.getDeptCosts.useQuery({ collegeId, deptId, month });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;

  const totals = data?.totals as {
    total_cost_usd?: number;
    llm_input_tokens?: number;
    llm_output_tokens?: number;
    embedding_tokens?: number;
    chat_message_count?: number;
    token_utilisation_pct?: number;
    cost_utilisation_pct?: number;
  } | undefined;

  const policy = data?.policy as {
    llm_token_limit_per_month?: number;
    cost_budget_usd_per_month?: number;
    max_chat_queries_per_student_per_day?: number;
  } | undefined;

  const actionBreakdown = (data?.by_action_type ?? []) as Array<{
    action_type: string;
    total_cost_usd: number;
    total_tokens: number;
    count: number;
  }>;

  const serviceBreakdown = (data?.by_service ?? []) as Array<{
    service: string;
    total_cost_usd: number;
    total_tokens: number;
  }>;

  const topStudents = (data?.top_students ?? []) as Array<{
    student_id: string;
    total_tokens: number;
    total_cost_usd: number;
    chat_message_count: number;
  }>;

  const perQueryAnalysis = data?.per_query_analysis as {
    avg_tokens_per_chat?: number;
    avg_cost_per_chat?: number;
    avg_tokens_per_embed?: number;
    avg_cost_per_embed?: number;
  } | undefined;

  const tokenUtil = totals?.token_utilisation_pct ?? 0;
  const costUtil = totals?.cost_utilisation_pct ?? 0;
  const totalTokens = (totals?.llm_input_tokens ?? 0) + (totals?.llm_output_tokens ?? 0) + (totals?.embedding_tokens ?? 0);

  const actionChartData = actionBreakdown
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .map(a => ({ name: ACTION_LABELS[a.action_type] ?? a.action_type, cost: a.total_cost_usd }));

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dashboard" className="text-gray-500 hover:text-white text-sm transition-colors">← Platform</Link>
        <span className="text-gray-700">/</span>
        <Link href={`/dashboard/colleges/${collegeId}/costs?month=${month}`} className="text-gray-500 hover:text-white text-sm transition-colors truncate max-w-[140px]">{collegeId}</Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold text-white truncate">{deptId} — Dept Detail</h1>
        <div className="ml-auto flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none">
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Link href={`/dashboard/colleges/${collegeId}/depts/${deptId}/policy`}
            className="bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 text-sm text-white transition-colors">
            Edit Policy
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Cost" value={fmt$(totals?.total_cost_usd ?? 0)} sub={`limit: $${policy?.cost_budget_usd_per_month ?? '—'}`} pct={costUtil} />
        <KPICard label="Tokens" value={fmtK(totalTokens)} sub={`limit: ${fmtK(policy?.llm_token_limit_per_month ?? 0)}`} pct={tokenUtil} />
        <KPICard label="Budget Used" value={`${costUtil.toFixed(1)}%`} sub={`of $${policy?.cost_budget_usd_per_month ?? 0}/mo`} pct={costUtil} />
        <KPICard label="Chat Messages" value={fmtK(totals?.chat_message_count ?? 0)} sub="this month" />
      </div>

      {/* Action breakdown + service breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Action type breakdown */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Cost by Action Type</h2>
          {actionChartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={actionChartData} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => `$${v.toFixed(3)}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} width={80} />
                  <Tooltip formatter={(v: any) => [`$${v ? Number(v).toFixed(4) : '0.0000'}`, 'Cost']} />

                  <Bar dataKey="cost" fill="#8b5cf6" radius={[0,2,2,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1">
                {actionBreakdown.sort((a, b) => b.total_cost_usd - a.total_cost_usd).map((a) => (
                  <div key={a.action_type} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{ACTION_LABELS[a.action_type] ?? a.action_type}</span>
                    <div className="flex gap-4 text-gray-500">
                      <span>{fmtK(a.count)} calls</span>
                      <span className="font-mono text-gray-300">{fmt$(a.total_cost_usd)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="h-44 flex items-center justify-center text-gray-600 text-sm">No data</div>}
        </div>

        {/* Service breakdown */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Cost by Service</h2>
          {serviceBreakdown.length > 0 ? (
            <div className="space-y-3">
              {serviceBreakdown.sort((a, b) => b.total_cost_usd - a.total_cost_usd).map((s) => {
                const pct = totals?.total_cost_usd ? (s.total_cost_usd / totals.total_cost_usd) * 100 : 0;
                const color = SERVICE_COLORS[s.service] ?? '#6b7280';
                return (
                  <div key={s.service}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-300 capitalize">{s.service.replace('_', ' ')}</span>
                      <div className="flex gap-3 text-gray-500">
                        <span>{fmtK(s.total_tokens)} tokens</span>
                        <span className="font-mono text-gray-300">{fmt$(s.total_cost_usd)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <div className="h-44 flex items-center justify-center text-gray-600 text-sm">No data</div>}

          {/* Per-query analysis */}
          {perQueryAnalysis && (
            <div className="mt-5 pt-4 border-t border-gray-800">
              <p className="text-xs font-semibold text-gray-400 mb-2">Per-Query Analysis</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <MetricBox label="Avg tokens / chat" value={fmtK(Math.round(perQueryAnalysis.avg_tokens_per_chat ?? 0))} />
                <MetricBox label="Avg cost / chat" value={fmt$(perQueryAnalysis.avg_cost_per_chat ?? 0)} />
                <MetricBox label="Avg tokens / embed" value={fmtK(Math.round(perQueryAnalysis.avg_tokens_per_embed ?? 0))} />
                <MetricBox label="Avg cost / embed" value={fmt$(perQueryAnalysis.avg_cost_per_embed ?? 0)} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top students */}
      {topStudents.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Top Students by Token Usage (masked)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-800">
                  <th className="pb-2 text-left">#</th>
                  <th className="pb-2 text-left">Student ID</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost USD</th>
                  <th className="pb-2 text-right">Chats</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {topStudents.map((s, i) => {
                  const masked = `${s.student_id.slice(0, 4)}****${s.student_id.slice(-2)}`;
                  return (
                    <tr key={s.student_id} className="hover:bg-gray-800/40">
                      <td className="py-2 text-gray-600 text-xs">{i + 1}</td>
                      <td className="py-2 text-gray-400 font-mono text-xs">{masked}</td>
                      <td className="py-2 text-right text-gray-300 font-mono text-xs">{fmtK(s.total_tokens)}</td>
                      <td className="py-2 text-right text-gray-300 font-mono text-xs">{fmt$(s.total_cost_usd)}</td>
                      <td className="py-2 text-right text-gray-400 text-xs">{fmtK(s.chat_message_count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Policy in effect */}
      {policy && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Policy in Effect</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <PolicyRow label="Token limit" value={fmtK(policy.llm_token_limit_per_month ?? 0) + '/mo'} />
            <PolicyRow label="Budget ceiling" value={`$${policy.cost_budget_usd_per_month ?? 0}/mo`} />
            <PolicyRow label="Student limit" value={`${policy.max_chat_queries_per_student_per_day ?? '—'} chats/day`} />
          </div>
        </div>
      )}
    </div>
  );
}

function KPICard({ label, value, sub, pct }: { label: string; value: string; sub: string; pct?: number }) {
  const color = (pct ?? 0) >= 90 ? 'bg-red-500' : (pct ?? 0) >= 75 ? 'bg-yellow-500' : 'bg-blue-500';
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-white mt-1">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      {pct !== undefined && (
        <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-2">
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="text-gray-200 font-mono mt-0.5">{value}</p>
    </div>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div><span className="text-gray-500">{label}: </span><span className="text-gray-300">{value}</span></div>
  );
}
