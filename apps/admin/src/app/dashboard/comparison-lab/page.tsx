'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

type Tab = 'run' | 'golden' | 'history' | 'regression';

const FAILURE_LABELS: Record<string, { label: string; cls: string }> = {
  none: { label: '✓ none — working as intended', cls: 'text-emerald-700 dark:text-emerald-400' },
  extraction_failure: { label: '⚠ extraction failure', cls: 'text-amber-700 dark:text-amber-400' },
  retrieval_failure: { label: '⚠ retrieval failure', cls: 'text-amber-700 dark:text-amber-400' },
  expected_divergence: { label: 'ℹ expected divergence', cls: 'text-muted-foreground' },
};

export default function ComparisonLabPage() {
  const { user } = useAuthStore();
  const collegeId = user?.college_id ?? '';
  const deptId = user?.dept_id ?? '';
  const [tab, setTab] = useState<Tab>('run');

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold mb-1">Frontier Comparison Lab</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Runs the same question through MediMind's grounded RAG pipeline and a frontier model with no book context, side by side.
      </p>

      <div className="flex gap-2 mb-6 border-b border-border">
        {(['run', 'golden', 'history', 'regression'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize border-b-2 -mb-px ${
              tab === t ? 'border-primary text-white' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'golden' ? 'Golden Questions' : t}
          </button>
        ))}
      </div>

      {tab === 'run' && <RunTab collegeId={collegeId} deptId={deptId} />}
      {tab === 'golden' && <GoldenQuestionsTab collegeId={collegeId} deptId={deptId} />}
      {tab === 'history' && <HistoryTab collegeId={collegeId} deptId={deptId} />}
      {tab === 'regression' && <RegressionTab collegeId={collegeId} deptId={deptId} />}
    </div>
  );
}

// ── Run tab ──────────────────────────────────────────────────────────────────

function RunTab({ collegeId, deptId }: { collegeId: string; deptId: string }) {
  const [question, setQuestion] = useState('');
  const run = trpc.comparisonLab.runComparison.useMutation();

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question to compare…"
          className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
        />
        <button
          onClick={() => run.mutate({ college_id: collegeId, dept_id: deptId, question_text: question })}
          disabled={run.isPending || !question.trim()}
          className="bg-primary/90 hover:bg-primary text-primary-foreground disabled:opacity-50 px-4 py-2 rounded text-sm"
        >
          {run.isPending ? 'Running…' : 'Run comparison'}
        </button>
      </div>

      {run.isError && <p className="text-xs text-destructive mb-4">{run.error.message}</p>}
      {run.data && <ComparisonCard runData={run.data} />}
    </div>
  );
}

function ComparisonCard({ runData }: { runData: any }) {
  const failure = FAILURE_LABELS[runData.failure_signature] ?? FAILURE_LABELS.none;
  return (
    <div className="bg-muted border border-border rounded-lg overflow-hidden text-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-card/50 border-b border-border">
        <span className="text-foreground truncate">{runData.question_text}</span>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">Faithfulness: {runData.faithfulness_score.toFixed(2)}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        <div className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">🌐 Frontier ({runData.frontier_model}) — no book context</p>
          <p className="text-foreground whitespace-pre-wrap">{runData.frontier_response_text}</p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            📖 MediMind grounded — {runData.grounded_sources.length} source{runData.grounded_sources.length === 1 ? '' : 's'}
          </p>
          <p className="text-foreground whitespace-pre-wrap">{runData.grounded_response_text}</p>
        </div>
      </div>
      <div className="px-4 py-3 border-t border-border bg-card/30">
        <p className="text-xs text-muted-foreground mb-2">{runData.judge_reasoning}</p>
        <p className={`text-xs font-medium ${failure.cls}`}>Failure signature: {failure.label}</p>
      </div>
    </div>
  );
}

// ── Golden Questions tab ─────────────────────────────────────────────────────

function GoldenQuestionsTab({ collegeId, deptId }: { collegeId: string; deptId: string }) {
  const [text, setText] = useState('');
  const utils = trpc.useUtils();
  const { data: questions } = trpc.comparisonLab.listGoldenQuestions.useQuery(
    { college_id: collegeId, dept_id: deptId },
    { enabled: !!collegeId && !!deptId },
  );
  const create = trpc.comparisonLab.createGoldenQuestion.useMutation({
    onSuccess: () => { setText(''); utils.comparisonLab.listGoldenQuestions.invalidate(); },
  });
  const remove = trpc.comparisonLab.deleteGoldenQuestion.useMutation({
    onSuccess: () => utils.comparisonLab.listGoldenQuestions.invalidate(),
  });

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        Recommended: 20–30 questions per subject, weighted toward topics that previously showed up in the unanswered-query log.
      </p>
      <div className="flex gap-2 mb-4">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a golden question…"
          className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
        />
        <button
          onClick={() => create.mutate({ college_id: collegeId, dept_id: deptId, question_text: text })}
          disabled={create.isPending || !text.trim()}
          className="bg-accent hover:bg-accent disabled:opacity-50 px-4 py-2 rounded text-sm"
        >
          Add
        </button>
      </div>

      <div className="space-y-1">
        {(questions ?? []).map((q: any) => (
          <div key={q._id} className="flex items-center justify-between bg-muted border border-border rounded px-3 py-2 text-sm">
            <span className="text-foreground truncate">{q.question_text}</span>
            <button
              onClick={() => remove.mutate({ college_id: collegeId, dept_id: deptId, question_id: q._id })}
              className="text-xs text-destructive hover:text-red-700 dark:hover:text-red-300 shrink-0 ml-2"
            >
              Remove
            </button>
          </div>
        ))}
        {(questions ?? []).length === 0 && <p className="text-xs text-muted-foreground">No golden questions yet.</p>}
      </div>
    </div>
  );
}

// ── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({ collegeId, deptId }: { collegeId: string; deptId: string }) {
  const { data } = trpc.comparisonLab.listRuns.useQuery(
    { college_id: collegeId, dept_id: deptId, limit: 20 },
    { enabled: !!collegeId && !!deptId },
  );
  const review = trpc.comparisonLab.reviewRun.useMutation();

  return (
    <div className="space-y-2">
      {(data?.runs ?? []).map((r: any) => {
        const failure = FAILURE_LABELS[r.failure_signature] ?? FAILURE_LABELS.none;
        return (
          <div key={r._id} className="bg-muted border border-border rounded p-3 text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-foreground truncate">{r.question_text}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">{new Date(r.created_at).toLocaleDateString()}</span>
            </div>
            <p className={`text-xs mb-2 ${failure.cls}`}>{failure.label} · faithfulness {r.faithfulness_score.toFixed(2)}</p>
            {!r.human_verdict ? (
              <div className="flex gap-1 flex-wrap">
                {(['grounded_better', 'frontier_better', 'equivalent', 'both_wrong'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => review.mutate({ college_id: collegeId, dept_id: deptId, run_id: r._id, human_verdict: v })}
                    className="text-xs bg-accent hover:bg-accent px-2 py-1 rounded"
                  >
                    {v.replace('_', ' ')}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Verdict: {r.human_verdict.replace('_', ' ')}</p>
            )}
          </div>
        );
      })}
      {(data?.runs ?? []).length === 0 && <p className="text-xs text-muted-foreground">No comparison runs yet.</p>}
    </div>
  );
}

// ── Regression tab ───────────────────────────────────────────────────────────

function RegressionTab({ collegeId, deptId }: { collegeId: string; deptId: string }) {
  const { data } = trpc.comparisonLab.regressionDashboard.useQuery(
    { college_id: collegeId, dept_id: deptId, days: 30 },
    { enabled: !!collegeId && !!deptId },
  );

  return (
    <div>
      {(data?.alerts ?? []).length > 0 && (
        <div className="mb-4 space-y-1">
          {data!.alerts.map((a: string, i: number) => (
            <p key={i} className="text-xs text-amber-700 dark:text-amber-400">⚠ {a}</p>
          ))}
        </div>
      )}

      <div className="bg-muted border border-border rounded-lg p-4 mb-4">
        <h2 className="text-sm font-medium mb-3 text-foreground">Faithfulness trend — last 30 days</h2>
        {(data?.faithfulness_trend ?? []).length === 0 && <p className="text-xs text-muted-foreground">No data yet.</p>}
        <div className="space-y-1">
          {(data?.faithfulness_trend ?? []).map((row: any) => (
            <div key={row.date} className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground w-20 shrink-0">{row.date}</span>
              <div className="flex-1 bg-accent rounded-full h-2">
                <div className="bg-emerald-500 rounded-full h-2" style={{ width: `${Math.round(row.avg_faithfulness * 100)}%` }} />
              </div>
              <span className="text-foreground w-10 text-right">{row.avg_faithfulness.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-muted border border-border rounded-lg p-4">
        <h2 className="text-sm font-medium mb-3 text-foreground">Flagged documents</h2>
        <p className="text-xs text-muted-foreground mb-3">Cited in a low-faithfulness run and themselves low quality_score — likely root cause.</p>
        {(data?.flagged_documents ?? []).length === 0 && <p className="text-xs text-muted-foreground">None flagged.</p>}
        {(data?.flagged_documents ?? []).map((d: any) => (
          <div key={d._id} className="flex items-center justify-between text-xs py-1">
            <span className="text-foreground truncate">{d.original_filename}</span>
            <span className="text-amber-700 dark:text-amber-400">quality {d.quality_score.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
