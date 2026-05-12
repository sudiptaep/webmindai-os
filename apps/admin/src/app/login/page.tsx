'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginAdmin } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';
import { useCollegeSlug } from '@/lib/college-context';

interface College {
  _id: string;
  name: string;
  slug: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function AdminLoginPage() {
  const router = useRouter();
  const collegeSlug = useCollegeSlug();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [colleges, setColleges] = useState<College[]>([]);
  const [slug, setSlug] = useState(collegeSlug);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (collegeSlug) return; // subdomain already resolved — no need for dropdown
    fetch(`${API}/api/v1/auth/colleges`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setColleges(data);
          if (data.length === 1) setSlug(data[0].slug);
        }
      })
      .catch(() => {});
  }, [collegeSlug]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug) { setError('College is required'); return; }
    setError('');
    setLoading(true);
    try {
      const { token, user } = await loginAdmin(email, password, slug);
      setAuth(token, user as unknown as Parameters<typeof setAuth>[1], slug);
      router.replace('/dashboard/documents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">Admin Login</h1>
        <p className="text-center text-sm text-gray-500 mb-6">Department Administrator</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!collegeSlug && (
            <div>
              <label className="block text-sm mb-1 text-gray-400">College</label>
              {colleges.length > 0 ? (
                <select
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  required
                >
                  <option value="">Select college</option>
                  {colleges.map((c) => (
                    <option key={c._id} value={c.slug}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="your-college"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              )}
            </div>
          )}
          <div>
            <label className="block text-sm mb-1 text-gray-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded py-2 text-sm font-medium transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="mt-4 flex flex-col items-center gap-2 text-sm text-gray-500">
          <Link href="/forgot-password" className="text-blue-400 hover:underline text-xs">
            Forgot password?
          </Link>
          <Link href="/accept-invite" className="text-blue-400 hover:underline text-xs">
            Accept invitation
          </Link>
        </div>
      </div>
    </div>
  );
}
