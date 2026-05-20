'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { AppShell } from '@/components/AppSidebar';
import { useDueTodayCards } from '@/hooks/useSRS';
import { SRSReviewSession } from '@/components/srs/SRSReviewSession';
import { SRSEmptyState } from '@/components/srs/SRSEmptyState';

export default function SRSReviewPage() {
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
      <ReviewContent />
    </AppShell>
  );
}

function ReviewContent() {
  const { data, loading, error } = useDueTodayCards();

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
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/srs"
          className="text-gray-500 hover:text-gray-300 transition-colors text-sm"
        >
          ← Overview
        </Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-sm font-semibold text-gray-300">Review Session</h1>
      </div>

      {data && data.cards.length === 0 && (
        <SRSEmptyState streak={data.streak} />
      )}

      {data && data.cards.length > 0 && (
        <SRSReviewSession cards={data.cards} />
      )}
    </div>
  );
}
