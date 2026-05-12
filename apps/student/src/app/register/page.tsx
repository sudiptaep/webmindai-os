'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerStudent } from '@/lib/auth';

interface College {
  _id: string;
  name: string;
  slug: string;
  type: 'medical' | 'engineering' | 'other';
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export default function RegisterPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const [colleges, setColleges] = useState<College[]>([]);
  const [collegesLoading, setCollegesLoading] = useState(true);
  const [selectedCollegeSlug, setSelectedCollegeSlug] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [semester, setSemester] = useState('1');
  const [year, setYear] = useState('1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedCollege = colleges.find((c) => c.slug === selectedCollegeSlug);
  const isMedical = selectedCollege?.type === 'medical';

  useEffect(() => {
    fetch(`${API}/api/v1/auth/colleges`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setColleges(data);
          if (data.length === 1) setSelectedCollegeSlug(data[0].slug);
        }
      })
      .catch(() => {})
      .finally(() => setCollegesLoading(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCollegeSlug) { setError('Select a college'); return; }
    setError('');
    setLoading(true);
    try {
      await registerStudent(
        {
          name,
          email,
          password,
          roll_number: rollNumber || undefined,
          semester: isMedical ? Number(year) : Number(semester),
        },
        selectedCollegeSlug,
      );
      setPending(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (pending) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">⏳</div>
          <h1 className="text-xl font-semibold mb-2">Registration Submitted</h1>
          <p className="text-gray-400 text-sm mb-6">
            Your account is pending admin approval. You will be able to log in once approved.
          </p>
          <button
            onClick={() => router.replace('/login')}
            className="text-sm text-blue-400 hover:underline"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">Create Account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* College dropdown */}
          <div>
            <label className="block text-sm mb-1 text-gray-400">College</label>
            {collegesLoading ? (
              <div className="text-sm text-gray-500 py-2">Loading colleges…</div>
            ) : (
              <select
                value={selectedCollegeSlug}
                onChange={(e) => setSelectedCollegeSlug(e.target.value)}
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

          <div>
            <label className="block text-sm mb-1 text-gray-400">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              required
            />
          </div>
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
              minLength={8}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1 text-gray-400">Roll No. (optional)</label>
              <input
                type="text"
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            {isMedical ? (
              <div>
                <label className="block text-sm mb-1 text-gray-400">Year</label>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  {[1, 2, 3, 4, 5, 6].map((y) => (
                    <option key={y} value={y}>Year {y}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-sm mb-1 text-gray-400">Semester</label>
                <select
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>Sem {s}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !selectedCollegeSlug}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded py-2 text-sm font-medium transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-400 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
