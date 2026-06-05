'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetPassword } from '@/lib/auth';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setError('');
    setLoading(true);
    try {
      await resetPassword(token, password, 'college_admin');
      setDone(true);
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-center mb-6">Reset Password</h1>
        {done ? (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 text-center">
            <p className="text-green-400 text-sm mb-4">Password updated successfully.</p>
            <Link href="/college-admin/login" className="text-blue-400 hover:text-blue-300 text-sm">Sign in →</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 bg-gray-900 rounded-xl p-6 border border-gray-800">
            <div>
              <label className="block text-sm text-gray-400 mb-1">New Password</label>
              <input type="password" required minLength={8} value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Confirm Password</label>
              <input type="password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading || !token}
              className="w-full bg-blue-600 hover:bg-blue-700 rounded py-2.5 text-sm font-medium disabled:opacity-50">
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function CollegeAdminResetPasswordPage() {
  return <Suspense><ResetPasswordForm /></Suspense>;
}
