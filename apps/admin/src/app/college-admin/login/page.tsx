'use client';

import { useState, useEffect, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { loginAdmin } from '@/lib/auth';
import { useAuthStore } from '@/store/auth.store';
import { useCollegeSlug } from '@/lib/college-context';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

interface College { _id: string; name: string; slug: string; }

export default function CollegeAdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <CollegeAdminLoginForm />
    </Suspense>
  );
}

function CollegeAdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const collegeSlug = useCollegeSlug();
  // ?college=<slug> in the URL takes over from the dropdown, e.g.
  // https://admin.medimindai.in/college-admin/login?college=scmch
  const collegeParam = searchParams.get('college') ?? '';
  const effectiveSlug = collegeSlug || collegeParam;
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (token && user?.role === 'college_admin') router.replace('/college-admin/dashboard');
  }, [token, user, router]);

  const [colleges, setColleges] = useState<College[]>([]);
  const [slug, setSlug] = useState(effectiveSlug);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (effectiveSlug) { setSlug(effectiveSlug); return; }
    fetch(`${API}/api/v1/auth/colleges`).then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) {
        setColleges(data);
        if (data.length === 1) setSlug(data[0].slug);
      }
    }).catch(() => {});
  }, [effectiveSlug]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug) { setError('College is required'); return; }
    setError('');
    setLoading(true);
    try {
      const { token, user } = await loginAdmin(email, password, slug, 'college_admin');
      setAuth(token, user as never, slug);
      router.replace('/college-admin/dashboard');
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">College Administration Portal</h1>
          <p className="text-muted-foreground text-sm mt-2">Medimind AI</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card rounded-xl p-6 border border-border">
          {!effectiveSlug && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">College</label>
              <select required value={slug} onChange={(e) => setSlug(e.target.value)}
                className="w-full bg-muted border border-border rounded px-3 py-2 text-sm">
                <option value="">Select college…</option>
                {colleges.map((c) => <option key={c._id} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-muted border border-border rounded px-3 py-2 text-sm" />
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <p className="text-center text-xs text-muted-foreground mt-2">
            Faculty login?{' '}
            <Link href="/dept-admin/login" className="text-primary hover:text-blue-300">Dept Admin Portal →</Link>
          </p>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-4">
          <Link href="/college-admin/forgot-password" className="hover:text-muted-foreground">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}
