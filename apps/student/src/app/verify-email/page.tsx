'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

function VerifyEmailContent() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token.');
      return;
    }

    fetch(`${API}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.ok) {
          setStatus('success');
        } else {
          const data = await r.json().catch(() => ({}));
          setStatus('error');
          setMessage(data.message ?? 'Verification failed or link expired.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Network error. Please try again.');
      });
  }, [token]);

  if (status === 'loading') {
    return <p className="text-gray-400 text-sm text-center">Verifying your email…</p>;
  }

  if (status === 'success') {
    return (
      <div className="text-center">
        <div className="text-green-400 text-5xl mb-4">✓</div>
        <h2 className="text-xl font-bold mb-2">Email verified!</h2>
        <p className="text-gray-400 text-sm mb-6">Your email address has been confirmed.</p>
        <Link
          href="/chat"
          className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded text-sm font-medium transition-colors"
        >
          Go to chat
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="text-red-400 text-5xl mb-4">✗</div>
      <h2 className="text-xl font-bold mb-2">Verification failed</h2>
      <p className="text-gray-400 text-sm mb-6">{message}</p>
      <Link href="/login" className="text-blue-400 hover:underline text-sm">
        Back to login
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Suspense fallback={<p className="text-gray-400 text-sm text-center">Loading…</p>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  );
}
