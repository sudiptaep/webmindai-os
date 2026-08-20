'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';
import { useIdleLogout } from '@/lib/useIdleLogout';
import { ThemeToggle } from '@/components/ThemeToggle';

const NAV = [
  { href: '/college-admin/dashboard', label: 'Dashboard' },
  { href: '/college-admin/departments', label: 'Departments' },
  { href: '/college-admin/analytics', label: 'Analytics' },
  { href: '/college-admin/faculty', label: 'Faculty' },
  { href: '/college-admin/students', label: 'Students' },
];

export default function CollegeAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, user, clearAuth } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !token) router.replace('/college-admin/login');
    if (mounted && token && user?.role !== 'college_admin') router.replace('/dept-admin/dashboard');
  }, [mounted, token, user, router]);

  async function handleLogout() {
    await logout();
    clearAuth();
    router.replace('/college-admin/login');
  }

  useIdleLogout(handleLogout, mounted && !!token && user?.role === 'college_admin');

  if (!mounted || !token || user?.role !== 'college_admin') return null;

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-56 bg-card border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <p className="font-semibold text-sm truncate">{user.name}</p>
          <p className="text-xs text-primary mt-0.5">{user.admin_title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">College Admin</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ href, label }) => {
            const active = pathname.startsWith(href);
            return (
              <Link key={href} href={href}
                className={`block px-3 py-2 rounded text-sm transition-colors ${active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'}`}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border flex items-center justify-between">
          <button onClick={handleLogout}
            className="text-left text-sm text-muted-foreground hover:text-foreground px-3 py-2">
            Logout
          </button>
          <ThemeToggle />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
