'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { extractText, type TextPage } from '@/lib/library';

interface Props {
  collegeId: string;
  docId: string;
}

export function DocxViewer({ collegeId, docId }: Props) {
  const { token } = useAuthStore();
  const [pages, setPages] = useState<TextPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!token) return;
    extractText(collegeId, docId, token)
      .then(res => setPages(res.pages))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load document'))
      .finally(() => setLoading(false));
  }, [collegeId, docId, token]);

  const filtered = search
    ? pages.filter(p => p.text.toLowerCase().includes(search.toLowerCase()))
    : pages;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-gray-700 flex items-center">
        <p className="text-xs text-gray-400 flex-1">Document text</p>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search..."
          className="text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-gray-100 placeholder-gray-500 w-44"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-gray-200 space-y-5">
        {loading && <p className="text-gray-400 text-center py-8">Loading document...</p>}
        {error   && <p className="text-red-400 text-center py-8">{error}</p>}
        {!loading && !error && filtered.map(p => (
          <div key={p.page_num} className="prose prose-invert prose-sm max-w-none">
            <div className="text-xs text-gray-500 mb-1 border-b border-gray-800 pb-1">Section {p.page_num}</div>
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
  );
}
