'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

const FACULTY_TITLES = ['Professor', 'Associate Prof', 'Assistant Prof', 'Lab In-Charge', 'Coordinator'] as const;

export default function AddFacultyPage() {
  const router = useRouter();
  const [form, setForm] = useState({ dept_id: '', name: '', email: '', faculty_title: '', phone: '' });
  const [error, setError] = useState('');

  const deptsQuery = trpc.collegeAdmin.listDepartments.useQuery();
  const createMutation = trpc.collegeAdmin.createDeptAdmin.useMutation({
    onSuccess: () => router.push('/college-admin/faculty'),
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    createMutation.mutate({
      dept_id: form.dept_id, name: form.name, email: form.email,
      faculty_title: (form.faculty_title as never) || undefined,
      phone: form.phone || undefined,
    });
  }

  return (
    <div className="max-w-md">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-200 text-sm">← Back</button>
        <h1 className="text-xl font-semibold">Add Faculty to Department</h1>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Department *</label>
          <select required value={form.dept_id} onChange={(e) => setForm((f) => ({ ...f, dept_id: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm">
            <option value="">Select department…</option>
            {(deptsQuery.data ?? []).filter((d) => !d.is_generic).map((d) => (
              <option key={String(d._id)} value={String(d._id)}>{d.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Full Name *</label>
          <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Work Email *</label>
          <input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Faculty Title</label>
          <select value={form.faculty_title} onChange={(e) => setForm((f) => ({ ...f, faculty_title: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm">
            <option value="">Select title…</option>
            {FACULTY_TITLES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Phone</label>
          <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
        </div>

        <p className="text-xs text-gray-500">Standard dept admin permissions will apply. An invitation email will be sent.</p>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="flex-1 border border-gray-700 rounded py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          <button type="submit" disabled={createMutation.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-700 rounded py-2 text-sm font-medium disabled:opacity-50">
            {createMutation.isPending ? 'Sending…' : 'Send Invitation'}
          </button>
        </div>
      </form>
    </div>
  );
}
