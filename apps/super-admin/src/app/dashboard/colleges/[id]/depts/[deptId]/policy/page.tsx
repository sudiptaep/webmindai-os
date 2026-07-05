'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';

type PolicyFields = {
  llm_token_limit_per_month: string;
  cost_budget_usd_per_month: string;
  cost_soft_warn_pct: string;
  max_chat_queries_per_student_per_day: string;
  max_ai_summaries_per_student_per_day: string;
  max_exam_gen_per_student_per_day: string;
  notes: string;
};

const EMPTY: PolicyFields = {
  llm_token_limit_per_month: '',
  cost_budget_usd_per_month: '',
  cost_soft_warn_pct: '',
  max_chat_queries_per_student_per_day: '',
  max_ai_summaries_per_student_per_day: '',
  max_exam_gen_per_student_per_day: '',
  notes: '',
};

function toFields(p: Record<string, unknown> | null): PolicyFields {
  if (!p) return EMPTY;
  return {
    llm_token_limit_per_month: String(p.llm_token_limit_per_month ?? ''),
    cost_budget_usd_per_month: String(p.cost_budget_usd_per_month ?? ''),
    cost_soft_warn_pct: String(p.cost_soft_warn_pct ?? ''),
    max_chat_queries_per_student_per_day: String(p.max_chat_queries_per_student_per_day ?? ''),
    max_ai_summaries_per_student_per_day: String(p.max_ai_summaries_per_student_per_day ?? ''),
    max_exam_gen_per_student_per_day: String(p.max_exam_gen_per_student_per_day ?? ''),
    notes: String(p.notes ?? ''),
  };
}

function numOrUndef(v: string) { const n = parseFloat(v); return isNaN(n) ? undefined : n; }
function intOrUndef(v: string) { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; }

const DEPT_MAX_BUDGET_USD = 50;

export default function DeptPolicyPage() {
  const params = useParams();
  const collegeId = params.id as string;
  const deptId = params.deptId as string;

  const utils = trpc.useUtils();
  const { data: existing, isLoading } = trpc.costPolicy.getDeptPolicy.useQuery({ deptId });
  const { data: collegePolicy } = trpc.costPolicy.getCollegePolicy.useQuery({ collegeId });
  const { data: globalPolicy } = trpc.costPolicy.getGlobalPolicy.useQuery();

  const setPolicy = trpc.costPolicy.setDeptPolicy.useMutation({
    onSuccess: () => { utils.costPolicy.getDeptPolicy.invalidate({ deptId }); setSaved(true); setTimeout(() => setSaved(false), 2000); },
    onError: (e) => setError(e.message),
  });
  const deletePolicy = trpc.costPolicy.deleteDeptPolicy.useMutation({
    onSuccess: () => { utils.costPolicy.getDeptPolicy.invalidate({ deptId }); setFields(EMPTY); },
    onError: (e) => setError(e.message),
  });

  const [fields, setFields] = useState<PolicyFields>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existing !== undefined) setFields(toFields(existing as Record<string, unknown> | null));
  }, [existing]);

  function set(key: keyof PolicyFields, value: string) {
    setFields(f => ({ ...f, [key]: value }));
    setError('');
  }

  function handleSave() {
    setError('');
    const budget = numOrUndef(fields.cost_budget_usd_per_month);
    if (budget !== undefined && budget > DEPT_MAX_BUDGET_USD) {
      setError(`Department budget cannot exceed $${DEPT_MAX_BUDGET_USD}/month.`);
      return;
    }
    setPolicy.mutate({
      deptId,
      collegeId,
      policy: {
        llm_token_limit_per_month: intOrUndef(fields.llm_token_limit_per_month),
        cost_budget_usd_per_month: budget,
        cost_soft_warn_pct: numOrUndef(fields.cost_soft_warn_pct),
        max_chat_queries_per_student_per_day: intOrUndef(fields.max_chat_queries_per_student_per_day),
        max_ai_summaries_per_student_per_day: intOrUndef(fields.max_ai_summaries_per_student_per_day),
        max_exam_gen_per_student_per_day: intOrUndef(fields.max_exam_gen_per_student_per_day),
        notes: fields.notes || undefined,
      },
    });
  }

  if (isLoading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>;

  const collegeLimits = collegePolicy as Record<string, unknown> | null;
  const globalLimits = globalPolicy as Record<string, unknown> | null;
  const inheritedBudget = collegeLimits?.cost_budget_usd_per_month ?? globalLimits?.cost_budget_usd_per_month ?? DEPT_MAX_BUDGET_USD;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/dashboard/colleges/${collegeId}/depts/${deptId}/costs`} className="text-gray-500 hover:text-white text-sm transition-colors">
          ← {deptId} costs
        </Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-xl font-bold text-white">Department Policy</h1>
      </div>

      {/* Inheritance banner */}
      <div className="bg-blue-950/30 border border-blue-800/40 rounded-lg px-4 py-3 text-xs text-blue-300">
        Blank fields inherit from the <strong>College Policy</strong> (or Global, if the college has no override).
        Department budget is capped at <strong>${DEPT_MAX_BUDGET_USD}/month</strong>.
      </div>

      {/* Form */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
        <Section title="Budget">
          <FieldRow
            label="Budget ceiling USD / month"
            placeholder={`inherited: $${inheritedBudget}`}
            value={fields.cost_budget_usd_per_month}
            onChange={v => set('cost_budget_usd_per_month', v)}
            hint={`Hard stop when this department's spend exceeds this amount. Max $${DEPT_MAX_BUDGET_USD}/month.`}
            max={DEPT_MAX_BUDGET_USD}
          />
          <FieldRow
            label="Cost warn threshold %"
            placeholder={`inherited: ${collegeLimits?.cost_soft_warn_pct ?? globalLimits?.cost_soft_warn_pct ?? 75}`}
            value={fields.cost_soft_warn_pct}
            onChange={v => set('cost_soft_warn_pct', v)}
          />
        </Section>

        <Section title="Token Limits">
          <FieldRow
            label="Token limit / month"
            placeholder={`inherited: ${collegeLimits?.llm_token_limit_per_month ?? globalLimits?.llm_token_limit_per_month ?? '—'}`}
            value={fields.llm_token_limit_per_month}
            onChange={v => set('llm_token_limit_per_month', v)}
            hint="Hard stop at this many tokens (input + output combined) for this department"
          />
        </Section>

        <Section title="Per-Student Rate Limits (per day)">
          <FieldRow
            label="Chat queries / student / day"
            placeholder={`inherited: ${collegeLimits?.max_chat_queries_per_student_per_day ?? globalLimits?.max_chat_queries_per_student_per_day ?? 50}`}
            value={fields.max_chat_queries_per_student_per_day}
            onChange={v => set('max_chat_queries_per_student_per_day', v)}
          />
          <FieldRow
            label="AI summaries / student / day"
            placeholder={`inherited: ${collegeLimits?.max_ai_summaries_per_student_per_day ?? globalLimits?.max_ai_summaries_per_student_per_day ?? 10}`}
            value={fields.max_ai_summaries_per_student_per_day}
            onChange={v => set('max_ai_summaries_per_student_per_day', v)}
          />
          <FieldRow
            label="Exam generations / student / day"
            placeholder={`inherited: ${collegeLimits?.max_exam_gen_per_student_per_day ?? globalLimits?.max_exam_gen_per_student_per_day ?? 5}`}
            value={fields.max_exam_gen_per_student_per_day}
            onChange={v => set('max_exam_gen_per_student_per_day', v)}
          />
        </Section>

        <Section title="Notes">
          <textarea
            value={fields.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Internal notes about this policy..."
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
            {setPolicy.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save Policy'}
          </button>
          {existing && (
            <button
              onClick={() => { if (confirm('Delete department override? Department will inherit college/global policy.')) deletePolicy.mutate({ deptId, collegeId }); }}
              disabled={deletePolicy.isPending}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
            >
              Delete override
            </button>
          )}
          <Link href={`/dashboard/colleges/${collegeId}/policy`} className="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Edit college policy →
          </Link>
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

function FieldRow({ label, value, onChange, placeholder, hint, max }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; max?: number;
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
        max={max}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  );
}
