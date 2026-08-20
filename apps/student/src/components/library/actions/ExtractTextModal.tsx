'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { extractText, extractTextDownloadUrl, type TextPage } from '@/lib/library';

interface Props {
  collegeId: string;
  docId: string;
  filename: string;
  totalPages: number | null;
  onClose: () => void;
}

export function ExtractTextModal({ collegeId, docId, filename, totalPages, onClose }: Props) {
  const { token } = useAuthStore();
  const [pages, setPages] = useState<TextPage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'full' | 'page'>('full');
  const [pageNum, setPageNum] = useState(1);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    extractText(collegeId, docId, token)
      .then(res => { setPages(res.pages); setTotal(res.total_pages); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load text'))
      .finally(() => setLoading(false));
  }, [collegeId, docId, token]);

  const displayPages = tab === 'page'
    ? pages.filter(p => p.page_num === pageNum)
    : pages;

  const filtered = search
    ? displayPages.map(p => ({
        ...p,
        text: p.text, // highlight handled in render
      }))
    : displayPages;

  function handleCopy() {
    const text = displayPages.map(p => `--- Page ${p.page_num} ---\n${p.text}`).join('\n\n');
    navigator.clipboard.writeText(text);
  }

  const txtUrl = `${extractTextDownloadUrl(collegeId, docId)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="relative bg-card rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-sm text-foreground truncate max-w-xs">
            Extracted Text — {filename}
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={handleCopy} className="text-xs px-3 py-1.5 bg-accent hover:bg-accent rounded-lg">Copy</button>
            <a
              href={txtUrl}
              download
              className="text-xs px-3 py-1.5 bg-accent hover:bg-accent rounded-lg"
            >
              ↓ .txt
            </a>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-1">✕</button>
          </div>
        </div>

        {/* Tab + search */}
        <div className="flex items-center gap-3 px-5 py-2 border-b border-border">
          <button
            onClick={() => setTab('full')}
            className={`text-xs px-3 py-1 rounded-full ${tab === 'full' ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Full Text
          </button>
          {totalPages && totalPages > 1 && (
            <button
              onClick={() => setTab('page')}
              className={`text-xs px-3 py-1 rounded-full ${tab === 'page' ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              By Page
            </button>
          )}
          {tab === 'page' && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Page</label>
              <input
                type="number" min={1} max={total || undefined} value={pageNum}
                onChange={e => setPageNum(Number(e.target.value))}
                className="w-16 text-xs bg-muted border border-border rounded px-2 py-1 text-white"
              />
              <span className="text-xs text-muted-foreground">of {total}</span>
            </div>
          )}
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search within text..."
            className="ml-auto text-xs bg-muted border border-border rounded-lg px-3 py-1.5 text-foreground placeholder-muted-foreground w-48"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm text-foreground space-y-4">
          {loading && <p className="text-muted-foreground text-center py-8">Loading text...</p>}
          {error  && <p className="text-destructive text-center py-8">{error}</p>}
          {!loading && !error && filtered.map(p => (
            <div key={p.page_num}>
              <p className="text-xs text-muted-foreground mb-1">— Page {p.page_num} —</p>
              <p className="whitespace-pre-wrap leading-relaxed">{
                search
                  ? p.text.split(new RegExp(`(${search})`, 'gi')).map((part, i) =>
                      part.toLowerCase() === search.toLowerCase()
                        ? <mark key={i} className="bg-yellow-400 text-black">{part}</mark>
                        : part
                    )
                  : p.text
              }</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
