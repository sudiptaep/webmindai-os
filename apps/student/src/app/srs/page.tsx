'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { AppShell } from '@/components/AppSidebar';
import { useSRSStats } from '@/hooks/useSRS';
import { SRSStatsPanel } from '@/components/srs/SRSStatsPanel';
import { SRSEmptyState } from '@/components/srs/SRSEmptyState';

export default function SRSPage() {
  const router = useRouter();
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
      <SRSOverview />
    </AppShell>
  );
}

function SRSOverview() {
  const { data, loading, error } = useSRSStats();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Spaced Repetition</h1>
          <p className="text-sm text-gray-500 mt-0.5">SM-2 algorithm — review at optimal intervals</p>
        </div>
        {data && data.due_today > 0 && (
          <Link
            href="/srs/review"
            className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors shrink-0"
          >
            Start Review ({data.due_today})
          </Link>
        )}
      </div>

      {data && <SRSStatsPanel stats={data} />}

      {data && data.due_today === 0 && (
        <SRSEmptyState streak={data.streak} />
      )}

      {data && data.due_today > 0 && (
        <div className="bg-[#151820] border border-teal-800/40 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-100">
              {data.due_today} card{data.due_today !== 1 ? 's' : ''} ready for review
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Reviewing regularly prevents forgetting — best done now
            </p>
          </div>
          <Link
            href="/srs/review"
            className="shrink-0 px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors"
          >
            Review Now
          </Link>
        </div>
      )}
    </div>
  );
}
