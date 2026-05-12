'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

export default function NewCollegePage() {
  const router = useRouter();
  const { token } = useAuthStore();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<'medical' | 'engineering' | 'other'>('engineering');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [tokenLimit, setTokenLimit] = useState('1000000');
  const [error, setError] = useState('');

  const createMut = trpc.college.create.useMutation({
    onSuccess: (college) => router.push(`/dashboard/colleges/${college._id}`),
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    createMut.mutate({
      name,
      slug,
      type,
      owner_email: ownerEmail,
      token_limit_per_month: Number(tokenLimit),
    });
  }

  return (
    <div className="max-w-lg">
      <button
        onClick={() => router.back()}
        className="text-sm text-gray-400 hover:text-gray-100 mb-4 flex items-center gap-1"
      >
        ← Back
      </button>
      <h1 className="text-xl font-semibold mb-6">Create College</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="College Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            required
          />
        </Field>
        <Field label="Slug (subdomain)">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="my-college"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            required
          />
          <p className="text-xs text-gray-500 mt-1">{slug || 'slug'}.yourplatform.com</p>
        </Field>
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="engineering">Engineering</option>
            <option value="medical">Medical</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Owner Email">
          <input
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="admin@college.edu"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            required
          />
        </Field>
        <Field label="Monthly Token Limit">
          <input
            type="number"
            value={tokenLimit}
            onChange={(e) => setTokenLimit(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            required
          />
        </Field>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={createMut.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded py-2 text-sm font-medium transition-colors"
        >
          {createMut.isPending ? 'Creating…' : 'Create College'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm mb-1 text-gray-400">{label}</label>
      {children}
    </div>
  );
}
