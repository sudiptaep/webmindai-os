'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { InviteStatusBadge } from '@/components/users/InviteStatusBadge';

type Tab = 'college_admins' | 'dept_admins';

export default function UsersPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('college_admins');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  const collegeAdminsQuery = trpc.superAdminUsers.listCollegeAdmins.useQuery(
    { q: search || undefined, status: (statusFilter as never) || undefined, page, limit: 20 },
    { enabled: tab === 'college_admins' },
  );
  const deptAdminsQuery = trpc.superAdminUsers.listDeptAdmins.useQuery(
    { q: search || undefined, status: (statusFilter as never) || undefined, page, limit: 20 },
    { enabled: tab === 'dept_admins' },
  );

  const data = tab === 'college_admins' ? collegeAdminsQuery.data : deptAdminsQuery.data;
  const isLoading = tab === 'college_admins' ? collegeAdminsQuery.isLoading : deptAdminsQuery.isLoading;

  const deleteCollegeAdmin = trpc.superAdminUsers.deleteCollegeAdmin.useMutation({
    onSuccess: () => collegeAdminsQuery.refetch(),
  });
  const deleteDeptAdmin = trpc.superAdminUsers.deleteDeptAdmin.useMutation({
    onSuccess: () => deptAdminsQuery.refetch(),
  });

  function handleDelete(admin: Record<string, string | undefined>) {
    if (!confirm(`Permanently delete ${admin.name}? This cannot be undone.`)) return;
    if (tab === 'college_admins') {
      deleteCollegeAdmin.mutate({ admin_id: admin._id!, college_id: admin.college_id! });
    } else {
      deleteDeptAdmin.mutate({ admin_id: admin._id!, college_id: admin.college_id! });
    }
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">User Management</h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/dashboard/users/college-admins/new')}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded"
          >
            + Create College Admin
          </button>
          <button
            onClick={() => router.push('/dashboard/users/dept-admins/new')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded"
          >
            + Create Dept Admin
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 mb-4">
        {(['college_admins', 'dept_admins'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t === 'college_admins' ? 'College Admins' : 'Dept Admins'}
            {data && (
              <span className="ml-2 text-xs text-gray-500">({data.total})</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search name or email..."
          value={search}
          onChange={handleSearch}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-64"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="pb-2 pr-4">Name</th>
              <th className="pb-2 pr-4">College</th>
              {tab === 'dept_admins' && <th className="pb-2 pr-4">Department</th>}
              <th className="pb-2 pr-4">{tab === 'college_admins' ? 'Title' : 'Faculty Title'}</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Last Login</th>
              <th className="pb-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {((data?.admins as Record<string, string | undefined>[]) ?? []).map((admin) => (
              <tr key={admin._id} className="border-b border-gray-800 hover:bg-gray-800/40">
                <td className="py-2 pr-4">
                  <p className="font-medium">{admin.name}</p>
                  <p className="text-gray-400 text-xs">{admin.email}</p>
                </td>
                <td className="py-2 pr-4 text-gray-300">{admin.college_name}</td>
                {tab === 'dept_admins' && <td className="py-2 pr-4 text-gray-300">{admin.dept_name}</td>}
                <td className="py-2 pr-4 text-gray-300">
                  {admin.admin_title ?? admin.faculty_title ?? '—'}
                </td>
                <td className="py-2 pr-4">
                  <InviteStatusBadge status={admin.status as string} />
                </td>
                <td className="py-2 pr-4 text-gray-400">
                  {admin.last_login ? new Date(admin.last_login as string).toLocaleDateString() : '—'}
                </td>
                <td className="py-2">
                  <button
                    onClick={() =>
                      router.push(
                        tab === 'college_admins'
                          ? `/dashboard/users/college-admins/${admin._id}?college_id=${admin.college_id}`
                          : `/dashboard/users/dept-admins/${admin._id}?college_id=${admin.college_id}`,
                      )
                    }
                    className="text-blue-400 hover:text-blue-300 text-xs mr-3"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(admin)}
                    className="text-red-500 hover:text-red-400 text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!data?.admins?.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-500">
                  No {tab === 'college_admins' ? 'college admins' : 'dept admins'} found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex justify-end gap-2 mt-4">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 text-sm border border-gray-700 rounded disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-3 py-1 text-sm text-gray-400">
            Page {page} of {Math.ceil(data.total / 20)}
          </span>
          <button
            disabled={page >= Math.ceil(data.total / 20)}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 text-sm border border-gray-700 rounded disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
