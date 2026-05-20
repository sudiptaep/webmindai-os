'use client';

import type { SRSStats } from '@/hooks/useSRS';

interface SRSStatsPanelProps {
  stats: SRSStats;
}

export function SRSStatsPanel({ stats }: SRSStatsPanelProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <StatCard label="Study Streak" value={stats.streak} unit="days" icon="🔥"
        sub={stats.streak >= 7 ? 'Keep it up!' : stats.streak === 0 ? 'Start reviewing today' : 'Review daily to grow'} />
      <StatCard label="Active Cards" value={stats.active_cards} unit="cards" icon="🃏"
        sub={`${stats.graduated_cards} graduated`} />
      <StatCard label="Due Today" value={stats.due_today} unit="to review" icon="⏰"
        sub={stats.due_today === 0 ? 'All caught up' : 'Ready for review'} />
      <StatCard label="Retention" value={stats.retention_rate_pct} unit="%" icon="🎯"
        sub="Last 30 days" highlight={stats.retention_rate_pct >= 80} />
      <StatCard label="Total Cards" value={stats.total_cards} unit="cards" icon="📦"
        sub={`${stats.active_cards} active · ${stats.graduated_cards} mastered`} />
      <StatCard label="Avg Ease" value={stats.avg_ease_factor} unit="" icon="⚡"
        sub="Higher = easier recall" decimal />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  unit: string;
  icon: string;
  sub: string;
  highlight?: boolean;
  decimal?: boolean;
}

function StatCard({ label, value, unit, icon, sub, highlight, decimal }: StatCardProps) {
  return (
    <div className="bg-[#151820] border border-gray-800/60 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${highlight ? 'text-teal-400' : 'text-gray-100'}`}>
        {decimal ? value.toFixed(2) : value}
        {unit && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}
      </p>
      <p className="text-xs text-gray-600">{sub}</p>
    </div>
  );
}
