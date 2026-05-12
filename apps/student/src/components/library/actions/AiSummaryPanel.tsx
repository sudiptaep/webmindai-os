'use client';

import { useState } from 'react';
import { useAiSummary } from '@/hooks/useAiSummary';

interface Props {
  collegeId: string;
  docId: string;
  filename: string;
  fileType?: string;
  pageCount?: number;
  onClose: () => void;
}

type Mode = 'brief' | 'detailed' | 'key-terms';

const MODES: { id: Mode; label: string }[] = [
  { id: 'brief',     label: 'Brief'     },
  { id: 'detailed',  label: 'Detailed'  },
  { id: 'key-terms', label: 'Key Terms' },
];

export function AiSummaryPanel({ collegeId, docId, filename, fileType, pageCount, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('brief');
  const [pageFrom, setPageFrom] = useState('');
  const [pageTo, setPageTo]     = useState('');
  const { content, status, tokensUsed, error, start, stop, reset } = useAiSummary(collegeId, docId);

  const supportsPageRange = (fileType === 'pdf' || fileType === 'pptx') && (pageCount ?? 0) > 1;

  function handleStart() {
    reset();
    const from = supportsPageRange && pageFrom ? Number(pageFrom) : undefined;
    const to   = supportsPageRange && pageTo   ? Number(pageTo)   : undefined;
    start(mode, from, to);
  }

  function handleCopy() { navigator.clipboard.writeText(content); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="font-semibold text-sm text-gray-100 truncate max-w-xs">
            AI Summary — {filename}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); reset(); }}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                mode === m.id ? 'bg-teal-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
          <button
            onClick={handleStart}
            disabled={status === 'streaming'}
            className="ml-auto text-xs px-4 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-full transition-colors"
          >
            {status === 'idle' || status === 'done' || status === 'error' ? 'Generate' : 'Generating...'}
          </button>
          {status === 'streaming' && (
            <button onClick={stop} className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-full">
              Stop
            </button>
          )}
        </div>

        {/* Page range (PDF / PPTX only) */}
        {supportsPageRange && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-800 bg-gray-950/40">
            <span className="text-xs text-gray-500 shrink-0">Page range</span>
            <input
              type="number"
              min={1}
              max={pageCount}
              placeholder="From"
              value={pageFrom}
              onChange={e => setPageFrom(e.target.value)}
              className="w-20 text-xs bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-teal-500"
            />
            <span className="text-xs text-gray-600">–</span>
            <input
              type="number"
              min={1}
              max={pageCount}
              placeholder={`To (max ${pageCount})`}
              value={pageTo}
              onChange={e => setPageTo(e.target.value)}
              className="w-28 text-xs bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-teal-500"
            />
            {(pageFrom || pageTo) && (
              <button
                onClick={() => { setPageFrom(''); setPageTo(''); }}
                className="text-xs text-gray-500 hover:text-gray-300 ml-auto"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {status === 'idle' && (
            <p className="text-gray-500 text-sm text-center py-8">Select a mode and click Generate.</p>
          )}
          {error && (
            <p className="text-red-400 text-sm text-center py-4">{error}</p>
          )}
          {content && (
            <div className="prose prose-invert prose-sm max-w-none text-gray-200 whitespace-pre-wrap leading-relaxed">
              {content}
              {status === 'streaming' && (
                <span className="inline-block w-0.5 h-4 bg-teal-400 ml-0.5 animate-pulse align-text-bottom" />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(status === 'done' || status === 'streaming') && content && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800">
            <span className="text-xs text-gray-500">
              {tokensUsed > 0 ? `${tokensUsed} tokens used` : ''}
            </span>
            <div className="flex gap-2">
              <button onClick={handleCopy} className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
