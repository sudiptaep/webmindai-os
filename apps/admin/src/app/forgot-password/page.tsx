'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useCollegeSlug } from '@/lib/college-context';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function ForgotPasswordPage() {
  const collegeSlug = useCollegeSlug();
  const [slug, setSlug] = useState(collegeSlug);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await fetch(`${API}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: 'dept_admin', college_slug: slug || collegeSlug }),
      });
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-green-700 dark:text-green-400 text-4xl mb-4">✓</div>
          <h1 className="text-xl font-bold mb-2">Check your email</h1>
          <p className="text-muted-foreground text-sm">
            If an account exists for <strong>{email}</strong>, we sent a reset link.
          </p>
          <Link href="/login" className="mt-6 inline-block text-primary hover:underline text-sm">
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">Reset Password</h1>
        <p className="text-muted-foreground text-sm text-center mb-6">Admin account password reset</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!collegeSlug && (
            <div>
              <label className="block text-sm mb-1 text-muted-foreground">College</label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="your-college"
                className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          )}
          <div>
            <label className="block text-sm mb-1 text-muted-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
              required
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded py-2 text-sm font-medium transition-colors"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className="text-center text-sm text-muted-foreground mt-4">
          <Link href="/login" className="text-primary hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
