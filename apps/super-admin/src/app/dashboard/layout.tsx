'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';
import { useIdleLogout } from '@/lib/useIdleLogout';
import { ThemeToggle } from '@/components/ThemeToggle';

const NAV: { href: string; label: string; exact?: boolean }[] = [
  { href: '/dashboard', label: 'Overview', exact: true },
  { href: '/dashboard/colleges', label: 'Colleges' },
  { href: '/dashboard/users', label: 'Users' },
  { href: '/dashboard/alerts', label: 'Alerts' },
  { href: '/dashboard/cost-planner', label: 'Cost Planner' },
  { href: '/dashboard/policies/global', label: 'Global Policy' },
  { href: '/dashboard/observatory', label: 'Observatory' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, clearAuth } = useAuthStore();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !token) router.replace('/login');
  }, [mounted, token, router]);

  async function handleLogout() {
    await logout();
    clearAuth();
    router.replace('/login');
  }

  useIdleLogout(handleLogout, mounted && !!token);

  if (!mounted || !token) return null;

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-card border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <p className="font-semibold text-sm">Platform Admin</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{user?.email}</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ href, label, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`block px-3 py-2 rounded text-sm transition-colors ${active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}
              >
                {label}
              </Link>
            );
          })}
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
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
