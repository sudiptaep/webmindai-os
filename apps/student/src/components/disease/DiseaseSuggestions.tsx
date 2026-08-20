'use client';

import type { DiseaseSuggestions } from '@/hooks/useDisease';

interface DiseaseSuggestionsProps {
  data:     DiseaseSuggestions;
  onSelect: (disease: string) => void;
}

export function DiseaseSuggestionsPanel({ data, onSelect }: DiseaseSuggestionsProps) {
  return (
    <div className="space-y-3">
      {data.recent_canonical.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Recent searches</p>
          <div className="flex flex-wrap gap-1.5">
            {data.recent_canonical.map(d => (
              <button
                key={d}
                onClick={() => onSelect(d)}
                className="text-xs px-3 py-1 rounded-full bg-teal-100 dark:bg-teal-900/20 border border-teal-800/30 text-teal-700 dark:text-teal-400 hover:text-teal-200 hover:bg-teal-100 dark:bg-teal-900/40 transition-colors capitalize"
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Popular conditions</p>
        <div className="flex flex-wrap gap-1.5">
          {data.popular_diseases.map(d => (
            <button
              key={d}
              onClick={() => onSelect(d)}
              className="text-xs px-3 py-1 rounded-full bg-muted/60 border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
