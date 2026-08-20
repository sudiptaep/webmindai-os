'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DiseaseSubjectResult } from '@/hooks/useDisease';

interface DiseaseResultCardProps {
  result: DiseaseSubjectResult;
}

export function DiseaseResultCard({ result }: DiseaseResultCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{result.subject_name}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{result.doc_filename}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {result.relevant_chunks.length} chunk{result.relevant_chunks.length !== 1 ? 's' : ''}
          </span>
          <Link
            href={`/library/${result.doc_id}`}
            className="text-xs text-teal-500 hover:text-teal-700 dark:text-teal-400 transition-colors"
          >
            Open →
          </Link>
        </div>
      </div>

      {/* Summary */}
      {result.summary && (
        <div className="px-4 pb-3 border-t border-border/40 pt-3">
          <p className="text-xs text-muted-foreground leading-relaxed">{result.summary}</p>
        </div>
      )}

      {/* Chunks toggle */}
      {result.relevant_chunks.length > 0 && (
        <div className="border-t border-border/40">
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full px-4 py-2 text-left text-xs text-muted-foreground hover:text-muted-foreground transition-colors flex items-center gap-1"
          >
            <span>{expanded ? '▲' : '▼'}</span>
            <span>{expanded ? 'Hide' : 'Show'} source chunks</span>
          </button>

          {expanded && (
            <div className="px-4 pb-3 space-y-2">
              {result.relevant_chunks.map((chunk, i) => (
                <div
                  key={chunk.chunk_id}
                  className="bg-muted border border-border/40 rounded-lg p-3 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-mono">#{i + 1}</span>
                    {chunk.chapter_title && (
                      <span className="text-[10px] text-muted-foreground">{chunk.chapter_title}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      p.{chunk.page_num} · {Math.round(chunk.relevance_score * 100)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-4">
                    {chunk.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
