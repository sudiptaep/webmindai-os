'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/auth/dept-admin/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? 'Failed to accept invitation');
      }
      setDone(true);
      setTimeout(() => router.replace('/login'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-red-400 mb-4">Missing invitation token.</p>
        <p className="text-gray-400 text-sm">Check the link in your invitation email.</p>
        <Link href="/login" className="mt-4 inline-block text-blue-400 hover:underline text-sm">
          Back to login
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="text-green-400 text-5xl mb-4">✓</div>
        <h2 className="text-xl font-bold mb-2">Account activated!</h2>
        <p className="text-gray-400 text-sm">Redirecting to login…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm mb-1 text-gray-400">Your Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm mb-1 text-gray-400">Set Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          required
          minLength={8}
        />
      </div>
      <div>
        <label className="block text-sm mb-1 text-gray-400">Confirm Password</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          required
          minLength={8}
        />
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded py-2 text-sm font-medium transition-colors"
      >
        {loading ? 'Activating…' : 'Activate account'}
      </button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">Accept Invitation</h1>
        <p className="text-gray-400 text-sm text-center mb-6">
          Set up your admin account to get started.
        </p>
        <Suspense fallback={<div className="text-gray-400 text-sm text-center">Loading…</div>}>
          <AcceptInviteForm />
        </Suspense>
        <p className="text-center text-sm text-gray-500 mt-4">
          <Link href="/login" className="text-blue-400 hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
