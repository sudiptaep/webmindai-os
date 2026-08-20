'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';
import { useIdleLogout } from '@/lib/useIdleLogout';
import { ThemeToggle } from '@/components/ThemeToggle';

const NAV = [
  { href: '/dashboard/documents', label: 'Documents' },
  { href: '/dashboard/pyq',       label: 'PYQ Papers' },
  { href: '/dashboard/subjects',  label: 'Subjects' },
  { href: '/dashboard/students',  label: 'Students' },
  { href: '/dashboard/teaching',  label: 'Teaching' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/comparison-lab', label: 'Comparison Lab' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, clearAuth } = useAuthStore();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !token) router.replace('/dept-admin/login');
    if (mounted && token && user?.role === 'college_admin') router.replace('/college-admin/dashboard');
  }, [mounted, token, user, router]);

  async function handleLogout() {
    await logout();
    clearAuth();
    router.replace('/dept-admin/login');
  }

  useIdleLogout(handleLogout, mounted && !!token && user?.role !== 'college_admin');

  if (!mounted || !token || user?.role === 'college_admin') return null;

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 bg-card border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <p className="font-semibold text-sm truncate">{user?.dept_name ?? 'Department'}</p>
          <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-0.5 truncate">{user?.name}</p>
          {user?.faculty_title && <p className="text-xs text-muted-foreground mt-0.5">{user.faculty_title}</p>}
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`block px-3 py-2 rounded text-sm transition-colors ${
                pathname.startsWith(href)
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-border flex items-center justify-between">
          <button
            onClick={handleLogout}
            className="text-left text-sm text-muted-foreground hover:text-foreground px-3 py-2"
          >
            Logout
          </button>
          <ThemeToggle />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
