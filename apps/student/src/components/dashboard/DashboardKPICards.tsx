'use client';

import Link from 'next/link';

interface DashboardKPICardsProps {
  srsCardsdue: number;
  streak: number;
  totalDocs: number;
  totalSubjects: number;
}

export function DashboardKPICards({
  srsCardsdue,
  streak,
  totalDocs,
  totalSubjects,
}: DashboardKPICardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* SRS due */}
      <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔄</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Daily Review</span>
        </div>
        <p className="text-2xl font-bold text-foreground">
          {srsCardsdue}
          <span className="text-sm font-normal text-muted-foreground ml-1">cards due</span>
        </p>
        {srsCardsdue > 0 ? (
          <Link
            href="/srs/review"
            className="mt-auto inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium transition-colors"
          >
            Start Review
          </Link>
        ) : (
          <p className="mt-auto text-xs text-muted-foreground">All caught up today</p>
        )}
      </div>

      {/* Streak */}
      <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔥</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Study Streak</span>
        </div>
        <p className="text-2xl font-bold text-foreground">
          {streak}
          <span className="text-sm font-normal text-muted-foreground ml-1">days</span>
        </p>
        <p className="mt-auto text-xs text-muted-foreground">
          {streak === 0 ? 'Start reviewing to build your streak' : streak >= 7 ? 'Keep it up!' : 'Review daily to keep streak going'}
        </p>
      </div>

      {/* Materials */}
      <div className="bg-card border border-border/60 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📚</span>
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Materials</span>
        </div>
        <p className="text-2xl font-bold text-foreground">
          {totalDocs}
          <span className="text-sm font-normal text-muted-foreground ml-1">docs</span>
        </p>
        <p className="mt-auto text-xs text-muted-foreground">
          {totalSubjects} subject{totalSubjects !== 1 ? 's' : ''} this semester
        </p>
      </div>
    </div>
  );
}
