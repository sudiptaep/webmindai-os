'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { AppShell } from '@/components/AppSidebar';
import { useDiseaseSearch, useDiseaseSuggestions } from '@/hooks/useDisease';
import { DiseaseSuggestionsPanel } from '@/components/disease/DiseaseSuggestions';
import { DiseaseResultView }       from '@/components/disease/DiseaseResultView';

export default function DiseasePage() {
  const router  = useRouter();
  const [mounted, setMounted] = useState(false);
  const token = useAuthStore((s) => s.token);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    if (!token) router.replace('/login');
  }, [mounted, token, router]);

  if (!mounted || !token) return null;

  return (
    <AppShell>
      <DiseaseSearchContent />
    </AppShell>
  );
}

function DiseaseSearchContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';

  const [query,       setQuery]       = useState(initialQuery);
  const [submitted,   setSubmitted]   = useState(false);

  const { result, loading, error, search } = useDiseaseSearch();
  const { data: suggestions } = useDiseaseSuggestions();

  // Auto-search when arriving with ?q=
  useEffect(() => {
    if (initialQuery && !submitted) {
      setSubmitted(true);
      search(initialQuery);
    }
  }, [initialQuery, submitted, search]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSubmitted(true);
    search(q);
  }, [query, search]);

  const handleSuggestionClick = useCallback((disease: string) => {
    setQuery(disease);
    setSubmitted(true);
    search(disease);
  }, [search]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Disease Search</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cross-subject search — draws from all uploaded materials
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search any disease — e.g. Myocardial Infarction, Tuberculosis…"
          className="flex-1 bg-[#151820] border border-gray-700/60 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-600/60 transition-colors"
        />
        <button
          type="submit"
          disabled={!query.trim() || loading}
          className="px-5 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shrink-0"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Searching
            </span>
          ) : 'Search'}
        </button>
      </form>

      {/* Suggestions — shown when no result yet */}
      {!result && !loading && suggestions && (
        <DiseaseSuggestionsPanel
          data={suggestions}
          onSelect={handleSuggestionClick}
        />
      )}

      {/* Error */}
      {error && (
        <div className="bg-[#151820] border border-red-800/40 rounded-xl p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="bg-[#151820] border border-gray-800/60 rounded-xl p-6 space-y-3 animate-pulse">
          <div className="h-4 bg-gray-800 rounded-lg w-1/3" />
          <div className="h-3 bg-gray-800 rounded-lg w-1/5" />
          <div className="h-px bg-gray-800 my-3" />
          <div className="h-3 bg-gray-800 rounded-lg w-full" />
          <div className="h-3 bg-gray-800 rounded-lg w-5/6" />
          <div className="h-3 bg-gray-800 rounded-lg w-4/6" />
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <DiseaseResultView result={result} />
      )}

      {/* Footer hint */}
      {result && suggestions && (
        <div className="pt-2">
          <p className="text-xs text-gray-600 mb-2">Search another condition</p>
          <DiseaseSuggestionsPanel
            data={suggestions}
            onSelect={handleSuggestionClick}
          />
        </div>
      )}
    </div>
  );
}
