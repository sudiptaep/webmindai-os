'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { useChatStore } from '@/store/chat.store';
import { logout } from '@/lib/auth';
import { trpc } from '@/lib/trpc';

// ─── Icons ────────────────────────────────────────────────────────────────────

export function IconPlus() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconClock() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function IconBook() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

export function IconUser() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function IconLogout() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function IconMenu() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function IconClose() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function IconSend() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export function IconGradCap() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

export function IconPanelLeft() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function IconDotsVertical() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function formatAcademicLevel(semester: number, collegeType?: string): string {
  if (collegeType === 'medical') {
    const year = Math.ceil(semester / 2);
    return `${ordinal(year)} Year`;
  }
  return `Semester ${semester}`;
}

// ─── SessionContextMenu ───────────────────────────────────────────────────────

interface SessionContextMenuProps {
  sessionId: string;
  isActiveSession?: boolean;
  onDeleted?: () => void;
  /** compact = sidebar style, full = history page style */
  variant?: 'compact' | 'full';
}

export function SessionContextMenu({
  sessionId,
  isActiveSession,
  onDeleted,
  variant = 'compact',
}: SessionContextMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const deleteMutation = trpc.student.deleteSession.useMutation({
    onSuccess: () => {
      utils.student.sessions.invalidate();
      if (isActiveSession) {
        router.push('/chat');
      }
      onDeleted?.();
    },
  });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    deleteMutation.mutate({ session_id: sessionId });
  }

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  }

  return (
    <div ref={menuRef} className="relative shrink-0" onClick={(e) => e.preventDefault()}>
      <button
        onClick={handleToggle}
        aria-label="Session options"
        className={`flex items-center justify-center rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/60 transition-colors cursor-pointer ${
          variant === 'compact' ? 'w-5 h-5' : 'w-7 h-7'
        }`}
      >
        <IconDotsVertical />
      </button>

      {open && (
        <div className="absolute right-0 top-6 z-50 w-36 bg-[#1e2330] border border-gray-700/60 rounded-lg shadow-xl py-1 overflow-hidden">
          <button
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
          >
            <IconTrash />
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── AppSidebar ───────────────────────────────────────────────────────────────

interface AppSidebarProps {
  currentSessionId?: string | null;
  onClose?: () => void;
  onCollapse?: () => void;
}

const NAV_ITEMS = [
  { label: 'Chats', icon: <IconClock />, href: '/history' },
  { label: 'Library', icon: <IconBook />, href: '/library' },
];

export function AppSidebar({ currentSessionId, onClose, onCollapse }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, clearAuth } = useAuthStore();
  const reset = useChatStore((s) => s.reset);

  const { data } = trpc.student.sessions.useQuery(
    { page: 1, limit: 20 },
    { enabled: !!token }
  );

  async function handleLogout() {
    await logout();
    clearAuth();
    router.replace('/login');
  }

  function handleNewChat() {
    reset();
    router.push('/chat');
    onClose?.();
  }

  return (
    <aside className="flex flex-col h-full bg-[#151820] border-r border-gray-800/60 w-64 shrink-0">
      {/* Logo / user */}
      <div className="px-3 py-3 border-b border-gray-800/60 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white shrink-0">
          <IconGradCap />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-100 truncate">
            {user?.college_type === 'medical' ? 'MedMind AI OS' : user?.college_type === 'engineering' ? 'Webmind OS' : 'EduMind AI'}
          </p>
        </div>
        <div className="ml-auto flex items-center">
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 cursor-pointer transition-colors lg:hidden"
              aria-label="Close sidebar"
            >
              <IconClose />
            </button>
          )}
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="hidden lg:flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-800/60 transition-colors cursor-pointer"
              aria-label="Collapse sidebar"
            >
              <IconPanelLeft />
            </button>
          )}
        </div>
      </div>

      {/* New Chat */}
      <div className="px-3 py-3">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors cursor-pointer"
        >
          <IconPlus />
          New Chat
        </button>
      </div>

      {/* Nav */}
      <nav className="px-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => onClose?.()}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                isActive
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Recent sessions */}
      {data?.sessions && data.sessions.length > 0 && (
        <div className="flex-1 overflow-y-auto mt-4 px-3 min-h-0">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider px-3 mb-2">Recent</p>
          <div className="space-y-0.5">
            {data.sessions.map((session: {
              _id: string;
              messages?: { role: string; content: string }[];
              last_active?: string;
              createdAt?: string;
            }) => {
              const isActive = session._id === currentSessionId;
              const label = session.messages?.find((m) => m.role === 'user')?.content ?? 'Untitled';
              return (
                <div
                  key={session._id}
                  className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                    isActive
                      ? 'bg-teal-600/15 text-teal-300 border border-teal-700/40'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  <Link
                    href={`/chat/${session._id}`}
                    onClick={() => onClose?.()}
                    className="flex-1 truncate leading-relaxed min-w-0"
                  >
                    {label}
                  </Link>
                  <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <SessionContextMenu
                      sessionId={session._id}
                      isActiveSession={isActive}
                      variant="compact"
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(!data?.sessions || data.sessions.length === 0) && <div className="flex-1" />}

      {/* Profile card + logout */}
      <div className="px-2 py-2 border-t border-gray-800/60">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-800/50 transition-colors group">
          {/* Avatar */}
          <Link href="/profile" className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-sm font-semibold shrink-0 select-none">
              {user?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-200 truncate leading-tight">
                {user?.name ?? 'Student'}
              </p>
              {user?.semester && (
                <p className="text-xs text-gray-600 truncate leading-tight">
                  {formatAcademicLevel(user.semester, user.college_type)}
                </p>
              )}
            </div>
          </Link>
          {/* Logout icon */}
          <button
            onClick={handleLogout}
            title="Sign out"
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer"
          >
            <IconLogout />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── AppShell ─────────────────────────────────────────────────────────────────

interface AppShellProps {
  currentSessionId?: string | null;
  children: React.ReactNode;
}

export function AppShell({ currentSessionId, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f1117]">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-30 transition-transform duration-200 lg:static lg:translate-x-0 lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <AppSidebar
          currentSessionId={currentSessionId}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/60 lg:hidden shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-gray-100 cursor-pointer transition-colors"
            aria-label="Open sidebar"
          >
            <IconMenu />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
