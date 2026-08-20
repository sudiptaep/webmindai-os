'use client';

import { useState } from 'react';
import type { DiseaseQueryResult } from '@/hooks/useDisease';
import { DiseaseResultCard } from './DiseaseResultCard';
import { DiseaseChatPanel }  from './DiseaseChatPanel';

type Tab = 'overview' | 'subjects' | 'ask';

interface DiseaseResultViewProps {
  result: DiseaseQueryResult;
}

export function DiseaseResultView({ result }: DiseaseResultViewProps) {
  const [tab, setTab] = useState<Tab>('overview');

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview',  label: 'Overview' },
    { id: 'subjects',  label: 'By Subject', count: result.subject_results.length },
    { id: 'ask',       label: 'Ask' },
  ];

  return (
    <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
      {/* Result header */}
      <div className="px-5 py-4 border-b border-border/60 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground capitalize">
            {result.disease_name.replace(/_/g, ' ')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Found in {result.subject_results.length} subject{result.subject_results.length !== 1 ? 's' : ''}
            {result.from_cache && (
              <span className="ml-2 text-primary">· cached</span>
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/60 px-4">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-teal-500 text-teal-700 dark:text-teal-400'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                tab === t.id ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400' : 'bg-muted text-muted-foreground'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* Compiled answer */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Cross-Subject Summary
              </p>
              <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {result.compiled_answer}
              </div>
            </div>

            {/* Cross connections */}
            {result.cross_connections.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Cross-Subject Connections
                </p>
                <ul className="space-y-1.5">
                  {result.cross_connections.map((conn, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="text-teal-600 shrink-0 mt-0.5">↔</span>
                      {conn}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Subject summary strip */}
            {result.subject_results.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Covered In
                </p>
                <div className="flex flex-wrap gap-2">
                  {result.subject_results.map(r => (
                    <span
                      key={r.subject_id}
                      className="text-xs px-3 py-1 rounded-full bg-muted/60 border border-border/40 text-muted-foreground"
                    >
                      {r.subject_name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.subject_results.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No subject-specific content found. Ask faculty to upload relevant textbooks.
              </p>
            )}
          </div>
        )}

        {tab === 'subjects' && (
          <div className="space-y-3">
            {result.subject_results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No subject results found.</p>
            ) : (
              result.subject_results.map(r => (
                <DiseaseResultCard key={r.subject_id} result={r} />
              ))
            )}
          </div>
        )}

        {tab === 'ask' && (
          <DiseaseChatPanel disease={result.disease_name} />
        )}
      </div>
    </div>
  );
}
