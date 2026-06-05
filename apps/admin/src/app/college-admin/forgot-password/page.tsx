'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { forgotPassword } from '@/lib/auth';
import { useCollegeSlug } from '@/lib/college-context';

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const collegeSlugFromCtx = useCollegeSlug();
  const slugFromQuery = searchParams.get('college_slug') ?? '';
  const slug = collegeSlugFromCtx || slugFromQuery;

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    await forgotPassword(email, slug, 'college_admin').catch(() => {});
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-center mb-6">Forgot Password</h1>
        {sent ? (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 text-center">
            <p className="text-green-400 text-sm mb-4">If that email exists, a reset link has been sent.</p>
            <Link href="/college-admin/login" className="text-blue-400 hover:text-blue-300 text-sm">Back to login →</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 bg-gray-900 rounded-xl p-6 border border-gray-800">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 rounded py-2.5 text-sm font-medium disabled:opacity-50">
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
            <p className="text-center text-xs text-gray-600">
              <Link href="/college-admin/login" className="hover:text-gray-400">Back to login</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function CollegeAdminForgotPasswordPage() {
  return <Suspense><ForgotPasswordForm /></Suspense>;
}
