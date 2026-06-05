'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

const FACULTY_TITLES = ['Professor', 'Associate Prof', 'Assistant Prof', 'Lab In-Charge', 'Coordinator'] as const;

export default function CreateDeptAdminPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    college_id: '', dept_id: '', name: '', email: '',
    faculty_title: '' as typeof FACULTY_TITLES[number] | '',
    phone: '',
    permissions: {
      can_upload_documents: true, can_delete_documents: true,
      can_manage_subjects: true, can_view_student_list: true, can_reset_student_passwords: false,
    },
  });
  const [error, setError] = useState('');

  const collegesQuery = trpc.college.list.useQuery({ limit: 100 });
  const deptsQuery = trpc.department.list.useQuery(
    { college_id: form.college_id },
    { enabled: !!form.college_id },
  );

  const createMutation = trpc.superAdminUsers.createDeptAdmin.useMutation({
    onSuccess: () => router.push('/dashboard/users'),
    onError: (e) => setError(e.message),
  });

  function handlePermissionChange(key: string, value: boolean) {
    setForm((f) => ({ ...f, permissions: { ...f.permissions, [key]: value } }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    createMutation.mutate({
      college_id: form.college_id, dept_id: form.dept_id,
      name: form.name, email: form.email,
      faculty_title: (form.faculty_title as never) || undefined,
      phone: form.phone || undefined,
      permissions: form.permissions,
    });
  }

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-200 text-sm">← Back</button>
        <h1 className="text-xl font-semibold">Create Dept Admin</h1>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">College *</label>
          <select
            required
            value={form.college_id}
            onChange={(e) => setForm((f) => ({ ...f, college_id: e.target.value, dept_id: '' }))}
            disabled={collegesQuery.isLoading}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="">
              {collegesQuery.isLoading ? 'Loading colleges…' : collegesQuery.isError ? 'Error loading colleges' : 'Select college…'}
            </option>
            {collegesQuery.data?.colleges.map((c) => (
              <option key={String(c._id)} value={String(c._id)}>{c.name}</option>
            ))}
          </select>
          {collegesQuery.isError && (
            <p className="text-red-400 text-xs mt-1">
              {(collegesQuery.error as { message?: string })?.message ?? 'Failed to load colleges. Re-login and try again.'}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Department *</label>
          <select
            required
            value={form.dept_id}
            onChange={(e) => setForm((f) => ({ ...f, dept_id: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            disabled={!form.college_id}
          >
            <option value="">Select department…</option>
            {deptsQuery.data?.map((d) => (
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
          <select value={form.faculty_title} onChange={(e) => setForm((f) => ({ ...f, faculty_title: e.target.value as never }))}
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

        <div>
          <p className="text-sm text-gray-400 mb-2">Permissions within their department</p>
          <div className="space-y-2 pl-1">
            {[
              ['can_upload_documents', 'Can upload documents'],
              ['can_delete_documents', 'Can delete documents'],
              ['can_manage_subjects', 'Can manage subjects'],
              ['can_view_student_list', 'Can view student list'],
              ['can_reset_student_passwords', 'Can reset student passwords'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.permissions[key as keyof typeof form.permissions]}
                  onChange={(e) => handlePermissionChange(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="flex-1 border border-gray-700 rounded py-2 text-sm text-gray-400 hover:text-gray-200">
            Cancel
          </button>
          <button type="submit" disabled={createMutation.isPending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded py-2 text-sm font-medium disabled:opacity-50">
            {createMutation.isPending ? 'Creating…' : 'Create & Send Invite'}
          </button>
        </div>
      </form>
    </div>
  );
}
