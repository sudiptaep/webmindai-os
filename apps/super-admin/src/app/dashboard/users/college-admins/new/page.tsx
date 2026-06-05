'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

const TITLES = ['Principal', 'HOD', 'Dean', 'Registrar', 'Academic Director', 'Custom'] as const;

export default function CreateCollegeAdminPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    college_id: '', name: '', email: '', admin_title: 'Principal' as typeof TITLES[number],
    custom_title: '', phone: '',
    permissions: {
      can_create_dept_admins: true, can_deactivate_dept_admins: true,
      can_view_student_list: true, can_export_reports: true, can_view_cost_usage: false,
    },
  });
  const [error, setError] = useState('');

  const collegesQuery = trpc.college.list.useQuery({ limit: 100 });
  const createMutation = trpc.superAdminUsers.createCollegeAdmin.useMutation({
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
      college_id: form.college_id, name: form.name, email: form.email,
      admin_title: form.admin_title,
      custom_title: form.admin_title === 'Custom' ? form.custom_title : undefined,
      phone: form.phone || undefined,
      permissions: form.permissions,
    });
  }

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-200 text-sm">← Back</button>
        <h1 className="text-xl font-semibold">Create College Admin</h1>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">College *</label>
          <select
            required
            value={form.college_id}
            onChange={(e) => setForm((f) => ({ ...f, college_id: e.target.value }))}
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
          <label className="block text-sm text-gray-400 mb-1">Title *</label>
          <select value={form.admin_title} onChange={(e) => setForm((f) => ({ ...f, admin_title: e.target.value as typeof TITLES[number] }))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm">
            {TITLES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>

        {form.admin_title === 'Custom' && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">Custom Title</label>
            <input value={form.custom_title} onChange={(e) => setForm((f) => ({ ...f, custom_title: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-1">Phone</label>
          <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm" />
        </div>

        <div>
          <p className="text-sm text-gray-400 mb-2">Permissions</p>
          <div className="space-y-2 pl-1">
            {[
              ['can_create_dept_admins', 'Can create dept admins'],
              ['can_deactivate_dept_admins', 'Can deactivate dept admins'],
              ['can_view_student_list', 'Can view student list'],
              ['can_export_reports', 'Can export reports'],
              ['can_view_cost_usage', 'Can view cost usage (billing)'],
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

        <p className="text-xs text-gray-500">An invitation email will be sent. They set their own password on first login.</p>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="flex-1 border border-gray-700 rounded py-2 text-sm text-gray-400 hover:text-gray-200">
            Cancel
          </button>
          <button type="submit" disabled={createMutation.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-700 rounded py-2 text-sm font-medium disabled:opacity-50">
            {createMutation.isPending ? 'Creating…' : 'Create & Send Invite'}
          </button>
        </div>
      </form>
    </div>
  );
}
