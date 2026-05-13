'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';
import { AppShell, SessionContextMenu } from '@/components/AppSidebar';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return days === 1 ? 'Yesterday' : `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export default function HistoryPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState('');
  const { token } = useAuthStore();

  const { data, isLoading } = trpc.student.sessions.useQuery(
    { page: 1, limit: 50 },
    { enabled: !!token }
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !token) router.replace('/login');
  }, [mounted, token, router]);

  const sessions = useMemo(() => {
    const all = data?.sessions ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((s: { messages?: { role: string; content: string }[] }) =>
      (s.messages?.find((m) => m.role === 'user')?.content ?? '').toLowerCase().includes(q)
    );
  }, [data, search]);

  if (!mounted || !token) return null;

  return (
    <AppShell>
      <div className="h-full flex flex-col">
        {/* Sticky header */}
        <div className="px-8 pt-10 pb-6 shrink-0">
          <div className="flex items-center justify-between mb-6 max-w-4xl mx-auto">
            <h1 className="text-3xl font-semibold text-gray-100">Chats</h1>
            <Link
              href="/chat"
              className="px-4 py-2 rounded-lg bg-white text-gray-900 text-sm font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
            >
              New chat
            </Link>
          </div>

          {/* Search */}
          <div className="relative max-w-4xl mx-auto">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats..."
              className="w-full bg-[#1c2030] border border-gray-700/40 rounded-xl pl-11 pr-4 py-3 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 transition-colors"
            />
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto scroll-smooth px-8 pb-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="max-w-4xl mx-auto">

            {/* Skeleton */}
            {isLoading && (
              <div className="space-y-0">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="py-5 border-b border-gray-800/40">
                    <div className="h-4 bg-gray-800/60 rounded animate-pulse w-2/3" />
                  </div>
                ))}
              </div>
            )}

            {/* Empty */}
            {!isLoading && sessions.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-20">
                {search ? 'No chats match your search.' : 'No conversations yet.'}
              </p>
            )}

            {/* Rows — no card bg, just dividers */}
            {sessions.map((session: {
              _id: string;
              messages?: { role: string; content: string }[];
              last_active?: string;
              createdAt?: string;
            }) => {
              const title = session.messages?.find((m) => m.role === 'user')?.content ?? 'Untitled';
              const date = session.last_active ?? session.createdAt ?? '';
              return (
                <div
                  key={session._id}
                  className="group flex items-center border-b border-gray-800/40 last:border-0 py-5 gap-3"
                >
                  <Link
                    href={`/chat/${session._id}`}
                    className="flex-1 flex items-center gap-4 min-w-0"
                  >
                    <span className="flex-1 text-sm font-medium text-gray-100 truncate">
                      {title}
                    </span>
                    {date && (
                      <span className="shrink-0 text-xs text-gray-500">
                        {timeAgo(date)}
                      </span>
                    )}
                  </Link>
                  <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <SessionContextMenu sessionId={session._id} variant="full" />
                  </span>
                </div>
              );
            })}

          </div>
        </div>
      </div>
    </AppShell>
  );
}
