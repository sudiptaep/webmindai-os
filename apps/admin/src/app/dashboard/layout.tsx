'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';

const NAV = [
  { href: '/dashboard/documents', label: 'Documents' },
  { href: '/dashboard/pyq',       label: 'PYQ Papers' },
  { href: '/dashboard/subjects',  label: 'Subjects' },
  { href: '/dashboard/students',  label: 'Students' },
  { href: '/dashboard/analytics', label: 'Analytics' },
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

  if (!mounted || !token || user?.role === 'college_admin') return null;

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <p className="font-semibold text-sm truncate">{user?.dept_name ?? 'Department'}</p>
          <p className="text-xs text-indigo-400 mt-0.5 truncate">{user?.name}</p>
          {user?.faculty_title && <p className="text-xs text-gray-500 mt-0.5">{user.faculty_title}</p>}
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`block px-3 py-2 rounded text-sm transition-colors ${
                pathname.startsWith(href)
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="w-full text-left text-sm text-gray-400 hover:text-gray-100 px-3 py-2"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
