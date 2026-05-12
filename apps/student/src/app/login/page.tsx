'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginStudent } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';
import { useCollegeSlug } from '@/lib/college-context';

interface College {
  _id: string;
  name: string;
  slug: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function LoginPage() {
  const router = useRouter();
  const collegeSlug = useCollegeSlug();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [colleges, setColleges] = useState<College[]>([]);
  const [collegesLoading, setCollegesLoading] = useState(!collegeSlug);
  const [slug, setSlug] = useState(collegeSlug);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (collegeSlug) return;
    fetch(`${API}/api/v1/auth/colleges`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setColleges(data);
          if (data.length === 1) setSlug(data[0].slug);
        }
      })
      .catch(() => {})
      .finally(() => setCollegesLoading(false));
  }, [collegeSlug]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug) { setError('Select a college'); return; }
    setError('');
    setLoading(true);
    try {
      const { token, user } = await loginStudent(email, password, slug);
      setAuth(token, user as unknown as Parameters<typeof setAuth>[1], slug);
      router.replace('/chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Student Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* College dropdown — only when slug not set by domain context */}
          {!collegeSlug && (
            <div>
              <label className="block text-sm mb-1 text-gray-400">College</label>
              {collegesLoading ? (
                <div className="text-sm text-gray-500 py-2">Loading colleges…</div>
              ) : (
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
            disabled={loading || (!collegeSlug && !slug)}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded py-2 text-sm font-medium transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-2">
          <Link href="/forgot-password" className="text-blue-400 hover:underline text-xs">
            Forgot password?
          </Link>
        </p>
        <p className="text-center text-sm text-gray-500 mt-3">
          No account?{' '}
          <Link href="/register" className="text-blue-400 hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
