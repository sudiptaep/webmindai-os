'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginAdmin } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';
import { useCollegeSlug } from '@/lib/college-context';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

interface College { _id: string; name: string; slug: string; }

export default function DeptAdminLoginPage() {
  const router = useRouter();
  const collegeSlug = useCollegeSlug();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (token && user?.role === 'dept_admin') router.replace('/dept-admin/dashboard');
  }, [token, user, router]);

  const [colleges, setColleges] = useState<College[]>([]);
  const [slug, setSlug] = useState(collegeSlug);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (collegeSlug) return;
    fetch(`${API}/api/v1/auth/colleges`).then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) {
        setColleges(data);
        if (data.length === 1) setSlug(data[0].slug);
      }
    }).catch(() => {});
  }, [collegeSlug]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug) { setError('College is required'); return; }
    setError('');
    setLoading(true);
    try {
      const { token, user } = await loginAdmin(email, password, slug, 'dept_admin');
      setAuth(token, user as never, slug);
      router.replace('/dept-admin/dashboard');
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">Department Admin Portal</h1>
          <p className="text-gray-400 text-sm mt-2">EduMind AI</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-gray-900 rounded-xl p-6 border border-gray-800">
          {!collegeSlug && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">College</label>
              <select required value={slug} onChange={(e) => setSlug(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm">
                <option value="">Select college…</option>
                {colleges.map((c) => <option key={c._id} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 rounded py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <p className="text-center text-xs text-gray-600 mt-2">
            Are you a Principal or HOD?{' '}
            <Link href="/college-admin/login" className="text-blue-400 hover:text-blue-300">College Admin Portal →</Link>
          </p>
        </form>

        <p className="text-center text-xs text-gray-600 mt-4">
          <Link href="/dept-admin/forgot-password" className="hover:text-gray-400">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}
