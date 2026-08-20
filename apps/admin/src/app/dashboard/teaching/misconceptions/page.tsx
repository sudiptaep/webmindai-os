'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

type SortMode = 'observed_count' | 'correction_success_rate';

export default function MisconceptionLibraryPage() {
  const [sort, setSort] = useState<SortMode>('observed_count');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: misconceptions, isLoading, refetch } = trpc.misconception.list.useQuery({
    sort,
    source: sourceFilter ? (sourceFilter as any) : undefined,
  });

  const update = trpc.misconception.update.useMutation({ onSuccess: () => { refetch(); setEditingId(null); } });
  const del = trpc.misconception.delete.useMutation({ onSuccess: () => refetch() });
  const mine = trpc.misconception.mine.useMutation({ onSuccess: () => refetch() });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/teaching" className="text-xs text-muted-foreground hover:text-foreground">← Teaching profile</Link>
          <h1 className="text-xl font-semibold mt-1">Misconception library</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Seeded automatically per concept, plus reinforced from your students' actual wrong answers.
          </p>
        </div>
        <button
          onClick={() => mine.mutate()}
          disabled={mine.isPending}
          className="text-xs bg-muted hover:bg-accent border border-border rounded px-3 py-1.5 disabled:opacity-50 whitespace-nowrap"
        >
          {mine.isPending ? 'Mining…' : 'Mine recent errors now'}
        </button>
      </div>

      <div className="flex gap-2 text-sm">
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} className="bg-card border border-border rounded px-3 py-1.5">
          <option value="observed_count">Most observed</option>
          <option value="correction_success_rate">Lowest correction rate</option>
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="bg-card border border-border rounded px-3 py-1.5">
          <option value="">All sources</option>
          <option value="llm_seeded">Seeded only</option>
          <option value="observed_from_students">Observed only</option>
          <option value="seeded_and_observed">Seeded + observed</option>
          <option value="faculty_authored">Faculty-authored</option>
        </select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {mine.isError && <p className="text-sm text-destructive">{mine.error.message}</p>}

      <div className="space-y-3">
        {(misconceptions ?? []).map((m) => (
          <div key={m._id} className="bg-muted border border-border rounded-lg p-4 text-sm">
            {editingId === m._id ? (
              <EditForm
                misconception={m}
                onCancel={() => setEditingId(null)}
                onSave={(patch) => update.mutate({ misconception_id: m._id, ...patch })}
                saving={update.isPending}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-foreground">"{m.statement}"</p>
                  <div className="flex items-center gap-1 shrink-0 text-xs">
                    <SourceBadge source={m.source} />
                  </div>
                </div>
                <p className="text-muted-foreground mt-1">Correct: {m.correct_model}</p>
                <p className="text-muted-foreground mt-1 italic">Probe: {m.diagnostic_probe}</p>

                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span>Observed: {m.observed_count}</span>
                  <span>Probed: {m.times_probed}</span>
                  <span className={m.correction_success_rate != null && m.correction_success_rate < 0.6 ? 'text-amber-700 dark:text-amber-400' : ''}>
                    Corrected: {m.correction_success_rate != null ? `${Math.round(m.correction_success_rate * 100)}%` : '—'}
                    {m.correction_success_rate != null && m.correction_success_rate < 0.6 && m.times_probed >= 3 ? ' ⚠ review wording' : ''}
                  </span>
                  {m.reviewed_by_faculty && <span className="text-teal-700 dark:text-teal-400">✓ reviewed</span>}
                </div>

                <div className="flex gap-3 mt-3">
                  <button onClick={() => setEditingId(m._id)} className="text-xs text-teal-700 dark:text-teal-400 hover:underline">Edit</button>
                  <button
                    onClick={() => { if (confirm('Delete this misconception?')) del.mutate({ misconception_id: m._id }); }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {misconceptions && misconceptions.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">No misconceptions match this filter.</p>
        )}
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    llm_seeded: 'Seeded',
    observed_from_students: 'Observed',
    seeded_and_observed: 'Seeded + observed',
    faculty_authored: 'Faculty',
  };
  return <span className="bg-card border border-border rounded-full px-2 py-0.5 text-muted-foreground">{labels[source] ?? source}</span>;
}

function EditForm({ misconception, onCancel, onSave, saving }: {
  misconception: any;
  onCancel: () => void;
  onSave: (patch: { statement: string; correct_model: string; diagnostic_probe: string; probe_correct_answer: string; probe_wrong_answer: string }) => void;
  saving: boolean;
}) {
  const [statement, setStatement] = useState(misconception.statement);
  const [correctModel, setCorrectModel] = useState(misconception.correct_model);
  const [probe, setProbe] = useState(misconception.diagnostic_probe);
  const [probeCorrect, setProbeCorrect] = useState(misconception.probe_correct_answer);
  const [probeWrong, setProbeWrong] = useState(misconception.probe_wrong_answer);

  return (
    <div className="space-y-2">
      <Field label="Statement" value={statement} onChange={setStatement} />
      <Field label="Correct model" value={correctModel} onChange={setCorrectModel} />
      <Field label="Diagnostic probe" value={probe} onChange={setProbe} />
      <Field label="Probe correct answer" value={probeCorrect} onChange={setProbeCorrect} />
      <Field label="Probe wrong answer" value={probeWrong} onChange={setProbeWrong} />
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave({ statement, correct_model: correctModel, diagnostic_probe: probe, probe_correct_answer: probeCorrect, probe_wrong_answer: probeWrong })}
          disabled={saving}
          className="text-xs bg-teal-700 hover:bg-teal-600 disabled:opacity-50 rounded px-3 py-1.5"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="text-xs bg-accent hover:bg-accent rounded px-3 py-1.5">Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm"
      />
    </div>
  );
}
