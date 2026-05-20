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
    <div className="bg-[#151820] border border-gray-800/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-200">{result.subject_name}</p>
          <p className="text-xs text-gray-600 truncate mt-0.5">{result.doc_filename}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-600">
            {result.relevant_chunks.length} chunk{result.relevant_chunks.length !== 1 ? 's' : ''}
          </span>
          <Link
            href={`/library/${result.doc_id}`}
            className="text-xs text-teal-500 hover:text-teal-400 transition-colors"
          >
            Open →
          </Link>
        </div>
      </div>

      {/* Summary */}
      {result.summary && (
        <div className="px-4 pb-3 border-t border-gray-800/40 pt-3">
          <p className="text-xs text-gray-400 leading-relaxed">{result.summary}</p>
        </div>
      )}

      {/* Chunks toggle */}
      {result.relevant_chunks.length > 0 && (
        <div className="border-t border-gray-800/40">
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full px-4 py-2 text-left text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-1"
          >
            <span>{expanded ? '▲' : '▼'}</span>
            <span>{expanded ? 'Hide' : 'Show'} source chunks</span>
          </button>

          {expanded && (
            <div className="px-4 pb-3 space-y-2">
              {result.relevant_chunks.map((chunk, i) => (
                <div
                  key={chunk.chunk_id}
                  className="bg-[#0f1117] border border-gray-800/40 rounded-lg p-3 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-600 font-mono">#{i + 1}</span>
                    {chunk.chapter_title && (
                      <span className="text-[10px] text-gray-500">{chunk.chapter_title}</span>
                    )}
                    <span className="text-[10px] text-gray-600 ml-auto">
                      p.{chunk.page_num} · {Math.round(chunk.relevance_score * 100)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-4">
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
