'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { acceptInvite } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const collegeSlug = searchParams.get('college_slug') ?? '';
  const setAuth = useAuthStore((s) => s.setAuth);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || !collegeSlug) setError('Invalid invitation link.');
  }, [token, collegeSlug]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setError('');
    setLoading(true);
    try {
      const { token: jwt, user } = await acceptInvite(token, password, collegeSlug, 'dept_admin');
      setAuth(jwt, user as never, collegeSlug);
      router.replace('/dept-admin/dashboard');
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Failed');
    } finally {
      setLoading(false);
    }
  }

  if (!token || !collegeSlug) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <p className="text-red-400">Invalid invitation link. Please contact your administrator.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-2">Set Your Password</h1>
        <p className="text-gray-400 text-sm text-center mb-8">Department Admin Portal · EduMind AI</p>

        <form onSubmit={handleSubmit} className="space-y-4 bg-gray-900 rounded-xl p-6 border border-gray-800">
          <div>
            <label className="block text-sm text-gray-400 mb-1">New Password</label>
            <input type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Confirm Password</label>
            <input type="password" required value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 rounded py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? 'Activating…' : 'Activate Account'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function DeptAdminAcceptInvitePage() {
  return <Suspense><AcceptInviteForm /></Suspense>;
}
