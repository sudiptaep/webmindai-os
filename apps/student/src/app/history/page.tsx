'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';
import { logout } from '@/lib/auth';

export default function HistoryPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { token, clearAuth } = useAuthStore();
  const { data, isLoading } = trpc.student.sessions.useQuery(
    { page: 1, limit: 20 },
    { enabled: !!token }
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !token) router.replace('/login');
  }, [mounted, token, router]);

  async function handleLogout() {
    await logout();
    clearAuth();
    router.replace('/login');
  }

  if (!mounted || !token) return null;

  return (
    <div className="min-h-screen p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Chat History</h1>
        <div className="flex gap-3">
          <Link
            href="/chat"
            className="text-sm bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded transition-colors"
          >
            New Chat
          </Link>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-gray-100"
          >
            Logout
          </button>
        </div>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Loading…</p>}

      {data?.sessions.length === 0 && (
        <p className="text-gray-500 text-sm">No conversations yet.</p>
      )}

      <div className="space-y-2">
        {data?.sessions.map((session: { _id: string; messages?: { content: string }[]; last_active?: string; createdAt?: string }) => (
          <Link
            key={session._id}
            href={`/chat/${session._id}`}
            className="block bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-lg px-4 py-3 transition-colors"
          >
            <p className="text-sm truncate">
              {session.messages?.[0]?.content ?? 'Empty session'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {new Date(session.last_active ?? session.createdAt ?? '').toLocaleString()}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
