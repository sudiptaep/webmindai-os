'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DiseaseSearchBar() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/disease?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="bg-[#151820] border border-gray-800/60 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🔬</span>
        <span className="text-sm font-semibold text-gray-300">Disease Search</span>
        <span className="text-xs text-gray-600 ml-1">— search across all your subjects</span>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search any disease — e.g. Myocardial Infarction, Tuberculosis…"
          className="flex-1 bg-[#0f1117] border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-600/60 transition-colors"
        />
        <button
          type="submit"
          disabled={!query.trim()}
          className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
        >
          Search
        </button>
      </form>
    </div>
  );
}
