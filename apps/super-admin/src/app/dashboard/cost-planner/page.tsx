'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

type SimResult = {
  active_students: number;
  projected_cost_usd: number;
  cost_per_dept_usd: number;
  cost_per_student_usd: number;
  revenue_inr: number;
  revenue_usd: number;
  margin_usd: number;
  margin_pct: number;
  recommended_token_limit: number;
  by_service: { anthropic_llm: number; openai_embeddings: number; pinecone: number };
};

const COLLEGE_PRESETS = {
  engineering: { students_per_dept: 200, avg_chats_per_student_per_day: 8, avg_tokens_per_chat: 2500, docs_per_dept_per_month: 3 },
  medical:     { students_per_dept: 150, avg_chats_per_student_per_day: 12, avg_tokens_per_chat: 3500, docs_per_dept_per_month: 5 },
  other:       { students_per_dept: 100, avg_chats_per_student_per_day: 6, avg_tokens_per_chat: 2000, docs_per_dept_per_month: 2 },
};

export default function CostPlannerPage() {
  const [form, setForm] = useState({
    college_type: 'engineering' as 'engineering' | 'medical' | 'other',
    num_depts: '5',
    students_per_dept: '200',
    active_ratio: '0.6',
    price_inr_per_dept: '8000',
    avg_chats_per_student_per_day: '8',
    avg_tokens_per_chat: '2500',
    avg_summaries_per_student_per_month: '5',
    avg_tokens_per_summary: '3000',
    docs_per_dept_per_month: '3',
    avg_pages_per_doc: '60',
    avg_tokens_per_page: '380',
  });
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState('');

  const simulate = trpc.superAdminDashboard.simulateCostPlan.useMutation({
    onSuccess: (data) => setResult(data as SimResult),
    onError: (e) => setError(e.message),
  });

  function set(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  function applyPreset(type: 'engineering' | 'medical' | 'other') {
    const p = COLLEGE_PRESETS[type];
    setForm(f => ({
      ...f,
      college_type: type,
      students_per_dept: String(p.students_per_dept),
      avg_chats_per_student_per_day: String(p.avg_chats_per_student_per_day),
      avg_tokens_per_chat: String(p.avg_tokens_per_chat),
      docs_per_dept_per_month: String(p.docs_per_dept_per_month),
    }));
  }

  function handleRun() {
    setError('');
    simulate.mutate({
      college_type: form.college_type,
      num_depts: parseInt(form.num_depts, 10) || 5,
      students_per_dept: parseInt(form.students_per_dept, 10) || 200,
      active_ratio: parseFloat(form.active_ratio) || 0.6,
      price_inr_per_dept: parseFloat(form.price_inr_per_dept) || 8000,
      avg_chats_per_student_per_day: parseFloat(form.avg_chats_per_student_per_day) || undefined,
      avg_tokens_per_chat: parseFloat(form.avg_tokens_per_chat) || undefined,
      avg_summaries_per_student_per_month: parseFloat(form.avg_summaries_per_student_per_month) || undefined,
      avg_tokens_per_summary: parseFloat(form.avg_tokens_per_summary) || undefined,
      docs_per_dept_per_month: parseFloat(form.docs_per_dept_per_month) || undefined,
      avg_pages_per_doc: parseFloat(form.avg_pages_per_doc) || undefined,
      avg_tokens_per_page: parseFloat(form.avg_tokens_per_page) || undefined,
    });
  }

  const marginColor = result
    ? result.margin_pct >= 60 ? 'text-green-400' : result.margin_pct >= 30 ? 'text-yellow-400' : 'text-red-400'
    : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="text-gray-500 hover:text-white text-sm transition-colors">← Platform Overview</Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold text-white">Cost Plan Builder</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input form */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">College Profile</p>

            {/* Type presets */}
            <div className="flex gap-2 mb-4">
              {(['engineering', 'medical', 'other'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => applyPreset(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${form.college_type === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <Row label="Number of departments" value={form.num_depts} onChange={v => set('num_depts', v)} />
              <Row label="Students per department" value={form.students_per_dept} onChange={v => set('students_per_dept', v)} />
              <Row label="Active student ratio (0-1)" value={form.active_ratio} onChange={v => set('active_ratio', v)} step="0.05" />
              <Row label="Price per dept / month (₹)" value={form.price_inr_per_dept} onChange={v => set('price_inr_per_dept', v)} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Usage Assumptions</p>
            <div className="space-y-3">
              <Row label="Chats / student / day" value={form.avg_chats_per_student_per_day} onChange={v => set('avg_chats_per_student_per_day', v)} />
              <Row label="Tokens / chat" value={form.avg_tokens_per_chat} onChange={v => set('avg_tokens_per_chat', v)} />
              <Row label="Summaries / student / month" value={form.avg_summaries_per_student_per_month} onChange={v => set('avg_summaries_per_student_per_month', v)} />
              <Row label="Tokens / summary" value={form.avg_tokens_per_summary} onChange={v => set('avg_tokens_per_summary', v)} />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Ingestion Assumptions</p>
            <div className="space-y-3">
              <Row label="Docs uploaded / dept / month" value={form.docs_per_dept_per_month} onChange={v => set('docs_per_dept_per_month', v)} />
              <Row label="Pages / doc" value={form.avg_pages_per_doc} onChange={v => set('avg_pages_per_doc', v)} />
              <Row label="Tokens / page" value={form.avg_tokens_per_page} onChange={v => set('avg_tokens_per_page', v)} />
            </div>
          </div>

          {error && <p className="text-red-400 text-xs bg-red-950/30 border border-red-900 rounded px-3 py-2">{error}</p>}

          <button
            onClick={handleRun}
            disabled={simulate.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium text-white transition-colors"
          >
            {simulate.isPending ? 'Calculating…' : 'Run Simulation →'}
          </button>
        </div>

        {/* Results */}
        <div className="space-y-4">
          {result ? (
            <>
              {/* Margin status */}
              <div className={`rounded-xl border p-5 ${result.margin_pct >= 60 ? 'bg-green-950/20 border-green-800' : result.margin_pct >= 30 ? 'bg-yellow-950/20 border-yellow-800' : 'bg-red-950/20 border-red-800'}`}>
                <p className="text-xs text-gray-400 mb-1">Projected Monthly Margin</p>
                <p className={`text-3xl font-bold ${marginColor}`}>{result.margin_pct.toFixed(1)}%</p>
                <p className="text-sm text-gray-400 mt-1">
                  Revenue: ₹{result.revenue_inr.toLocaleString()} · Cost: ${result.projected_cost_usd.toFixed(2)}
                </p>
              </div>

              {/* KPI grid */}
              <div className="grid grid-cols-2 gap-3">
                <KPIBox label="Active Students" value={result.active_students.toLocaleString()} />
                <KPIBox label="Total Cost USD" value={`$${result.projected_cost_usd.toFixed(2)}`} />
                <KPIBox label="Cost / Dept" value={`$${result.cost_per_dept_usd.toFixed(2)}`} />
                <KPIBox label="Cost / Student" value={`$${result.cost_per_student_usd.toFixed(4)}`} />
              </div>

              {/* By service */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 mb-3">Cost Breakdown by Service</p>
                <div className="space-y-2">
                  {[
                    { label: 'Anthropic LLM', v: result.by_service.anthropic_llm, color: '#8b5cf6' },
                    { label: 'OpenAI Embeddings', v: result.by_service.openai_embeddings, color: '#10b981' },
                    { label: 'Pinecone', v: result.by_service.pinecone, color: '#f59e0b' },
                  ].map(({ label, v, color }) => {
                    const pct = result.projected_cost_usd > 0 ? (v / result.projected_cost_usd) * 100 : 0;
                    return (
                      <div key={label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-400">{label}</span>
                          <span className="text-gray-300 font-mono">${v.toFixed(4)} ({pct.toFixed(0)}%)</span>
                        </div>
                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recommended token limit */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 mb-2">Recommended Token Limit / Month</p>
                <p className="text-2xl font-bold text-white font-mono">
                  {result.recommended_token_limit >= 1_000_000
                    ? `${(result.recommended_token_limit / 1_000_000).toFixed(1)}M`
                    : `${(result.recommended_token_limit / 1000).toFixed(0)}K`}
                </p>
                <p className="text-xs text-gray-500 mt-1">= projected usage × 1.2 buffer</p>
                <Link href="/dashboard/policies/global" className="inline-block mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                  Apply to global policy →
                </Link>
              </div>
            </>
          ) : (
            <div className="h-full min-h-[300px] bg-gray-900 border border-gray-800 rounded-xl flex items-center justify-center">
              <div className="text-center text-gray-600">
                <p className="text-3xl mb-2">📊</p>
                <p className="text-sm">Fill in the profile and run simulation</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, onChange, step }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-gray-300 flex-1">{label}</label>
      <input
        type="number"
        step={step ?? '1'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white text-right focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  );
}

function KPIBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-white mt-0.5 font-mono">{value}</p>
    </div>
  );
}
