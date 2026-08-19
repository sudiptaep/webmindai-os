'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

export default function TeachingAnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = trpc.teachingAnalytics.analytics.useQuery({ days });
  const { data: struggle } = trpc.teachingAnalytics.struggleReport.useQuery({ days });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/teaching" className="text-xs text-gray-500 hover:text-gray-300">← Teaching profile</Link>
          <h1 className="text-xl font-semibold mt-1">Teaching analytics</h1>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Stat label="Avg checks to mastery" value={data.avg_checks_to_mastery.toFixed(1)} />
            <Stat label="Concepts taught" value={String(data.most_taught_concepts.length)} />
          </div>

          <section className="bg-gray-800 border border-gray-700 rounded-lg p-5">
            <h2 className="font-medium mb-3 text-sm">Most-taught concepts</h2>
            {data.most_taught_concepts.length === 0 ? (
              <p className="text-xs text-gray-500">No teaching sessions in this window yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-700">
                    <th className="py-1.5 font-normal">Concept</th>
                    <th className="py-1.5 font-normal text-right">Sessions</th>
                    <th className="py-1.5 font-normal text-right">Avg checks</th>
                    <th className="py-1.5 font-normal text-right">Backtrack rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.most_taught_concepts.map((c) => (
                    <tr key={c.concept_id} className="border-b border-gray-800/60 last:border-0">
                      <td className="py-1.5">{c.canonical_name}</td>
                      <td className="py-1.5 text-right text-gray-300">{c.sessions}</td>
                      <td className="py-1.5 text-right text-gray-300">{c.avg_checks.toFixed(1)}</td>
                      <td className={`py-1.5 text-right ${c.backtrack_rate >= 0.3 ? 'text-amber-400' : 'text-gray-300'}`}>
                        {Math.round(c.backtrack_rate * 100)}%{c.backtrack_rate >= 0.3 ? ' ⚠' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="bg-gray-800 border border-gray-700 rounded-lg p-5">
            <h2 className="font-medium mb-3 text-sm">Backtrack hotspots</h2>
            {data.backtrack_hotspots.length === 0 ? (
              <p className="text-xs text-gray-500">No hotspots detected — no concept's students are consistently missing a prerequisite.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {data.backtrack_hotspots.map((h) => (
                  <p key={`${h.concept_id}-${h.prerequisite_id}`} className="text-amber-400">
                    ⚠ {Math.round(h.rate * 100)}% of students teaching themselves <strong>{h.concept_name}</strong> required
                    a prerequisite back-track — most commonly to <strong>{h.prerequisite_name}</strong> ({h.count}/{h.sessions}).
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="bg-gray-800 border border-gray-700 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium text-sm">Top misconceptions observed</h2>
              <Link href="/dashboard/teaching/misconceptions" className="text-xs text-teal-400 hover:underline">Manage →</Link>
            </div>
            {data.misconception_frequency.length === 0 ? (
              <p className="text-xs text-gray-500">None observed yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-700">
                    <th className="py-1.5 font-normal">Misconception</th>
                    <th className="py-1.5 font-normal text-right">Students</th>
                    <th className="py-1.5 font-normal text-right">Corrected</th>
                  </tr>
                </thead>
                <tbody>
                  {data.misconception_frequency.map((m: any) => {
                    const rate = m.correction_success_rate;
                    return (
                      <tr key={m._id} className="border-b border-gray-800/60 last:border-0">
                        <td className="py-1.5 truncate max-w-xs">{m.statement}</td>
                        <td className="py-1.5 text-right text-gray-300">{m.observed_count}</td>
                        <td className={`py-1.5 text-right ${rate != null && rate < 0.6 ? 'text-amber-400' : 'text-gray-300'}`}>
                          {rate != null ? `${Math.round(rate * 100)}%${rate < 0.6 ? ' ⚠' : ''}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {struggle && (struggle.concepts_with_high_backtrack.length > 0 || struggle.low_correction_misconceptions.length > 0) && (
        <section className="bg-amber-950/20 border border-amber-900/50 rounded-lg p-5">
          <h2 className="font-medium mb-3 text-sm text-amber-300">Struggle report — actionable</h2>
          <div className="space-y-2 text-xs text-amber-200">
            {struggle.concepts_with_high_backtrack.map((c) => (
              <p key={c.concept_id}>⚠ {c.recommendation}</p>
            ))}
            {struggle.low_correction_misconceptions.map((m) => (
              <p key={m.misconception_id}>⚠ "{m.statement}" — {m.recommendation}</p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
    </div>
  );
}
