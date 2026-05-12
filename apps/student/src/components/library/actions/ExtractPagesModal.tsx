'use client';

import { useState } from 'react';
import { useExtractPages } from '@/hooks/useExtractPages';

interface Props {
  collegeId: string;
  docId: string;
  filename: string;
  maxPages: number;
  onClose: () => void;
}

export function ExtractPagesModal({ collegeId, docId, filename, maxPages, onClose }: Props) {
  const [from, setFrom] = useState(1);
  const [to, setTo]     = useState(Math.min(10, maxPages));
  const { status, tokenUrl, expiresAt, error, estimatedSeconds, submit, reset } = useExtractPages(collegeId, docId);

  const pageCount = Math.max(0, to - from + 1);

  function handleSubmit() {
    if (from < 1 || to > maxPages || from > to) return;
    submit({ page_from: from, page_to: to });
  }

  function handleClose() { reset(); onClose(); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={handleClose}>
      <div
        className="bg-gray-900 rounded-2xl w-full max-w-sm p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-100">Extract Pages</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <p className="text-xs text-gray-400 mb-4 truncate">{filename}</p>

        {status === 'idle' || status === 'failed' ? (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">From</label>
                <input
                  type="number" min={1} max={maxPages} value={from}
                  onChange={e => setFrom(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-400 mb-1 block">To</label>
                <input
                  type="number" min={1} max={maxPages} value={to}
                  onChange={e => setTo(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-4">
              {pageCount > 0 ? `${pageCount} page${pageCount !== 1 ? 's' : ''} selected (max ${maxPages})` : 'Invalid range'}
            </p>

            {status === 'failed' && error && (
              <p className="text-xs text-red-400 mb-3">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={pageCount < 1 || pageCount > 100 || from > to}
              className="w-full py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Extract Pages
            </button>
          </>
        ) : status === 'pending' || status === 'processing' ? (
          <div className="text-center py-6">
            <div className="inline-block w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-gray-300">Generating extracted PDF...</p>
            <p className="text-xs text-gray-500 mt-1">Estimated: ~{estimatedSeconds}s</p>
            <div className="mt-3 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        ) : status === 'completed' && tokenUrl ? (
          <div className="text-center py-4">
            <p className="text-green-400 text-lg mb-2">✓ Ready!</p>
            <a
              href={tokenUrl}
              download={`pages_${from}-${to}.pdf`}
              className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              ↓ Download Pages {from}–{to}
            </a>
            {expiresAt && (
              <p className="text-xs text-gray-500 mt-2">
                Link expires {new Date(expiresAt).toLocaleTimeString()}
              </p>
            )}
            <button onClick={reset} className="block mx-auto mt-3 text-xs text-gray-400 hover:text-white">
              Extract different pages
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
