'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

const KNOWN_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7', 'gpt-4o', 'gpt-4o-mini'];

type PolicyFields = {
  llm_token_limit_per_month: string;
  llm_token_soft_warn_pct: string;
  cost_budget_usd_per_month: string;
  cost_soft_warn_pct: string;
  max_chat_queries_per_student_per_day: string;
  max_ai_summaries_per_student_per_day: string;
  max_exam_gen_per_student_per_day: string;
  allowed_llm_models: string[];
  storage_limit_gb: string;
  notes: string;
};

const DEFAULTS: PolicyFields = {
  llm_token_limit_per_month: '5000000',
  llm_token_soft_warn_pct: '80',
  cost_budget_usd_per_month: '20',
  cost_soft_warn_pct: '80',
  max_chat_queries_per_student_per_day: '50',
  max_ai_summaries_per_student_per_day: '10',
  max_exam_gen_per_student_per_day: '5',
  allowed_llm_models: ['claude-haiku-4-5-20251001'],
  storage_limit_gb: '10',
  notes: '',
};

function toFields(p: Record<string, unknown> | null): PolicyFields {
  if (!p) return DEFAULTS;
  return {
    llm_token_limit_per_month: String(p.llm_token_limit_per_month ?? DEFAULTS.llm_token_limit_per_month),
    llm_token_soft_warn_pct: String(p.llm_token_soft_warn_pct ?? DEFAULTS.llm_token_soft_warn_pct),
    cost_budget_usd_per_month: String(p.cost_budget_usd_per_month ?? DEFAULTS.cost_budget_usd_per_month),
    cost_soft_warn_pct: String(p.cost_soft_warn_pct ?? DEFAULTS.cost_soft_warn_pct),
    max_chat_queries_per_student_per_day: String(p.max_chat_queries_per_student_per_day ?? DEFAULTS.max_chat_queries_per_student_per_day),
    max_ai_summaries_per_student_per_day: String(p.max_ai_summaries_per_student_per_day ?? DEFAULTS.max_ai_summaries_per_student_per_day),
    max_exam_gen_per_student_per_day: String(p.max_exam_gen_per_student_per_day ?? DEFAULTS.max_exam_gen_per_student_per_day),
    allowed_llm_models: Array.isArray(p.allowed_llm_models) ? p.allowed_llm_models as string[] : DEFAULTS.allowed_llm_models,
    storage_limit_gb: String(p.storage_limit_gb ?? DEFAULTS.storage_limit_gb),
    notes: String(p.notes ?? ''),
  };
}

function numOrUndef(v: string) { const n = parseFloat(v); return isNaN(n) ? undefined : n; }
function intOrUndef(v: string) { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; }

export default function GlobalPolicyPage() {
  const utils = trpc.useUtils();
  const { data: existing, isLoading } = trpc.costPolicy.getGlobalPolicy.useQuery();
  const setPolicy = trpc.costPolicy.setGlobalPolicy.useMutation({
    onSuccess: () => { utils.costPolicy.getGlobalPolicy.invalidate(); setSaved(true); setTimeout(() => setSaved(false), 2500); },
    onError: (e) => setError(e.message),
  });

  const [fields, setFields] = useState<PolicyFields>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existing !== undefined) setFields(toFields(existing as Record<string, unknown> | null));
  }, [existing]);

  function set(key: keyof PolicyFields, value: string | string[]) {
    setFields(f => ({ ...f, [key]: value }));
    setError('');
  }

  function toggleModel(model: string) {
    const cur = fields.allowed_llm_models;
    set('allowed_llm_models', cur.includes(model) ? cur.filter(m => m !== model) : [...cur, model]);
  }

  function handleSave() {
    setError('');
    setPolicy.mutate({
      llm_token_limit_per_month: intOrUndef(fields.llm_token_limit_per_month),
      llm_token_soft_warn_pct: numOrUndef(fields.llm_token_soft_warn_pct),
      cost_budget_usd_per_month: numOrUndef(fields.cost_budget_usd_per_month),
      cost_soft_warn_pct: numOrUndef(fields.cost_soft_warn_pct),
      max_chat_queries_per_student_per_day: intOrUndef(fields.max_chat_queries_per_student_per_day),
      max_ai_summaries_per_student_per_day: intOrUndef(fields.max_ai_summaries_per_student_per_day),
      max_exam_gen_per_student_per_day: intOrUndef(fields.max_exam_gen_per_student_per_day),
      allowed_llm_models: fields.allowed_llm_models.length > 0 ? fields.allowed_llm_models : undefined,
      storage_limit_gb: numOrUndef(fields.storage_limit_gb),
      notes: fields.notes || undefined,
    });
  }

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="text-gray-500 hover:text-white text-sm transition-colors">← Platform Overview</Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold text-white">Global Policy</h1>
      </div>

      <div className="bg-yellow-950/20 border border-yellow-800/40 rounded-lg px-4 py-3 text-xs text-yellow-300">
        Global policy is the <strong>fallback baseline</strong> for all colleges and departments. College/dept-specific overrides take precedence.
        Changing this affects every college that has no college-level override.
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
        <Section title="Token Limits">
          <FieldRow label="Token limit / month" value={fields.llm_token_limit_per_month} onChange={v => set('llm_token_limit_per_month', v)} hint="Platform-wide default hard stop" />
          <FieldRow label="Soft warn threshold %" value={fields.llm_token_soft_warn_pct} onChange={v => set('llm_token_soft_warn_pct', v)} hint="Alert at this % of limit" />
        </Section>

        <Section title="Budget">
          <FieldRow label="Budget ceiling USD / month" value={fields.cost_budget_usd_per_month} onChange={v => set('cost_budget_usd_per_month', v)} />
          <FieldRow label="Cost warn threshold %" value={fields.cost_soft_warn_pct} onChange={v => set('cost_soft_warn_pct', v)} />
        </Section>

        <Section title="Per-Student Rate Limits (per day)">
          <FieldRow label="Chat queries / student / day" value={fields.max_chat_queries_per_student_per_day} onChange={v => set('max_chat_queries_per_student_per_day', v)} />
          <FieldRow label="AI summaries / student / day" value={fields.max_ai_summaries_per_student_per_day} onChange={v => set('max_ai_summaries_per_student_per_day', v)} />
          <FieldRow label="Exam generations / student / day" value={fields.max_exam_gen_per_student_per_day} onChange={v => set('max_exam_gen_per_student_per_day', v)} />
        </Section>

        <Section title="Allowed LLM Models (default)">
          <div className="space-y-1.5">
            {KNOWN_MODELS.map(m => (
              <label key={m} className="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" checked={fields.allowed_llm_models.includes(m)} onChange={() => toggleModel(m)} className="accent-blue-500" />
                <span className="text-sm text-gray-300 group-hover:text-white transition-colors font-mono">{m}</span>
              </label>
            ))}
          </div>
        </Section>

        <Section title="Storage">
          <FieldRow label="Storage limit GB" value={fields.storage_limit_gb} onChange={v => set('storage_limit_gb', v)} />
        </Section>

        <Section title="Notes">
          <textarea
            value={fields.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Internal notes..."
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
          />
        </Section>

        {error && <p className="text-red-400 text-xs bg-red-950/30 border border-red-900 rounded px-3 py-2">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={setPolicy.isPending}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors"
          >
            {setPolicy.isPending ? 'Saving…' : saved ? '✓ Saved — all colleges updated' : 'Save Global Policy'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldRow({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 items-start">
      <div>
        <p className="text-sm text-gray-300">{label}</p>
        {hint && <p className="text-xs text-gray-600 mt-0.5">{hint}</p>}
      </div>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  );
}
