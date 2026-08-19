'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

const STRATEGY_LABELS: Record<string, string> = {
  analogy: 'Analogy',
  first_principles: 'First principles',
  worked_example: 'Worked example',
  contrast_pair: 'Contrast pair',
  concrete_instance: 'Concrete instance',
  visual_spatial: 'Visual / spatial',
  extreme_case: 'Extreme case',
  error_analysis: 'Error analysis',
  narrative_history: 'Narrative / history',
  mnemonic: 'Mnemonic',
};

export default function TeachingProfilePage() {
  const { token } = useAuthStore();

  const { data: profile, isLoading, refetch } = trpc.teachingProfile.get.useQuery(undefined, {
    enabled: !!token,
  });
  const update = trpc.teachingProfile.update.useMutation({ onSuccess: () => refetch() });

  const [form, setForm] = useState<typeof profile | null>(null);
  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  if (isLoading || !form) return <p className="text-gray-400 text-sm">Loading…</p>;

  function set<K extends keyof NonNullable<typeof form>>(key: K, value: NonNullable<typeof form>[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function save() {
    if (!form) return;
    update.mutate({
      strategy_preference_order: form.strategy_preference_order as any,
      analogy_policy: form.analogy_policy,
      mnemonic_policy: form.mnemonic_policy,
      rigour_level: form.rigour_level,
      always_include_clinical_connect: form.always_include_clinical_connect,
      require_feynman_check: form.require_feynman_check,
      require_misconception_probe: form.require_misconception_probe,
      default_bloom_target: form.default_bloom_target,
      default_entry_difficulty: form.default_entry_difficulty,
      max_session_minutes: form.max_session_minutes,
      max_backtrack_depth: form.max_backtrack_depth,
      custom_instruction: form.custom_instruction,
    });
  }

  function moveStrategy(index: number, dir: -1 | 1) {
    const order = [...form!.strategy_preference_order];
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    set('strategy_preference_order', order as any);
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Teaching profile</h1>
        <div className="flex gap-3">
          <a href="/dashboard/teaching/misconceptions" className="text-xs text-teal-400 hover:underline">Misconceptions →</a>
          <a href="/dashboard/teaching/analytics" className="text-xs text-teal-400 hover:underline">Analytics →</a>
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        Configures how the adaptive teaching engine ("Teach me") explains concepts to your students.
      </p>

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 space-y-5 text-sm">
        <div>
          <label className="block text-gray-400 mb-2">Strategy preference order (tiebreaker only — strategies are still matched to concept type)</label>
          <div className="space-y-1">
            {form.strategy_preference_order.map((s, i) => (
              <div key={s} className="flex items-center gap-2 bg-gray-900 rounded px-3 py-1.5">
                <span className="text-gray-500 w-5">{i + 1}.</span>
                <span className="flex-1">{STRATEGY_LABELS[s] ?? s}</span>
                <button onClick={() => moveStrategy(i, -1)} className="text-gray-400 hover:text-gray-100 px-1">↑</button>
                <button onClick={() => moveStrategy(i, 1)} className="text-gray-400 hover:text-gray-100 px-1">↓</button>
              </div>
            ))}
          </div>
        </div>

        <Select label="Analogy policy" value={form.analogy_policy}
          onChange={(v) => set('analogy_policy', v as any)}
          options={[['sparing', 'Sparing'], ['liberal', 'Liberal'], ['avoid', 'Avoid']]} />

        <Select label="Mnemonic policy" value={form.mnemonic_policy}
          onChange={(v) => set('mnemonic_policy', v as any)}
          options={[['freely', 'Freely'], ['only_for_lists', 'Only for lists'], ['avoid', 'Avoid']]} />

        <Select label="Rigour level" value={form.rigour_level}
          onChange={(v) => set('rigour_level', v as any)}
          options={[['high', 'High'], ['balanced', 'Balanced'], ['accessible', 'Accessible']]} />

        <Select label="Default Bloom target" value={form.default_bloom_target}
          onChange={(v) => set('default_bloom_target', v as any)}
          options={[['remember', 'Remember'], ['understand', 'Understand'], ['apply', 'Apply'], ['analyse', 'Analyse']]} />

        <div className="grid grid-cols-2 gap-4">
          <NumberField label="Default entry difficulty (L0-L3)" value={form.default_entry_difficulty}
            min={0} max={3} onChange={(v) => set('default_entry_difficulty', v)} />
          <NumberField label="Max session minutes" value={form.max_session_minutes}
            min={5} max={60} onChange={(v) => set('max_session_minutes', v)} />
          <NumberField label="Max backtrack depth" value={form.max_backtrack_depth}
            min={0} max={5} onChange={(v) => set('max_backtrack_depth', v)} />
        </div>

        <Checkbox label="Always include clinical/practical connect phase" checked={form.always_include_clinical_connect}
          onChange={(v) => set('always_include_clinical_connect', v)} />
        <Checkbox label="Require Feynman check (explain it back)" checked={form.require_feynman_check}
          onChange={(v) => set('require_feynman_check', v)} />
        <Checkbox label="Require misconception probe when one exists" checked={form.require_misconception_probe}
          onChange={(v) => set('require_misconception_probe', v)} />

        <div>
          <label className="block text-gray-400 mb-1">Custom instruction (added to every teaching turn's prompt)</label>
          <textarea
            value={form.custom_instruction}
            onChange={(e) => set('custom_instruction', e.target.value)}
            rows={3}
            maxLength={2000}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
            placeholder="e.g. Always relate mechanisms back to underlying physiology before pharmacology."
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={save}
          disabled={update.isPending}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded text-sm"
        >
          {update.isPending ? 'Saving…' : 'Save profile'}
        </button>
        {update.isSuccess && <span className="text-xs text-emerald-400">Saved</span>}
        {update.isError && <span className="text-xs text-red-400">{update.error.message}</span>}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <label className="block text-gray-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-gray-400 mb-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
      />
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
