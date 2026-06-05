'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

export default function CollegeAdminDashboard() {
  const router = useRouter();
  const dashQuery = trpc.collegeAdmin.getDashboard.useQuery();

  if (dashQuery.isLoading) return <p className="text-gray-400 text-sm">Loading dashboard…</p>;

  const data = dashQuery.data;
  const depts = (data?.departments as Record<string, unknown>[]) ?? [];
  const deptAdmins = (data?.dept_admins as Record<string, unknown>[]) ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">College Overview</h1>
        <button
          onClick={() => router.push('/college-admin/faculty/new')}
          className="bg-blue-600 hover:bg-blue-700 text-sm px-4 py-2 rounded text-white"
        >
          + Add Dept Admin
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-2xl font-bold">{depts.filter((d) => !(d as Record<string, unknown>).is_generic).length}</p>
          <p className="text-sm text-gray-400 mt-1">Departments</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-2xl font-bold">{data?.kpi?.total_students ?? 0}</p>
          <p className="text-sm text-gray-400 mt-1">Total Students</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-2xl font-bold">{deptAdmins.filter((a) => (a as Record<string, unknown>).status === 'active').length}</p>
          <p className="text-sm text-gray-400 mt-1">Active Faculty</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-2xl font-bold">{deptAdmins.filter((a) => (a as Record<string, unknown>).status === 'invited').length}</p>
          <p className="text-sm text-gray-400 mt-1">Pending Invites</p>
        </div>
      </div>

      {/* Departments Table */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Departments</h2>
      <div className="bg-gray-800 rounded-lg overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">Documents</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {depts
              .filter((d) => !(d as Record<string, unknown>).is_generic)
              .map((dept) => {
                const d = dept as Record<string, unknown>;
                const admin = deptAdmins.find((a) => (a as Record<string, unknown>).dept_id === String(d._id)) as Record<string, unknown> | undefined;
                return (
                  <tr key={String(d._id)} className="border-b border-gray-700 hover:bg-gray-700/40">
                    <td className="px-4 py-3 font-medium">{d.name as string}</td>
                    <td className="px-4 py-3 text-gray-300">{admin?.name as string ?? <span className="text-yellow-400 text-xs">No admin</span>}</td>
                    <td className="px-4 py-3 text-gray-300">{d.document_count as number}</td>
                    <td className="px-4 py-3">
                      {admin
                        ? <span className="text-green-400 text-xs">Active</span>
                        : <span className="text-yellow-400 text-xs">Vacant</span>}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => router.push(`/college-admin/departments/${String(d._id)}`)}
                        className="text-blue-400 hover:text-blue-300 text-xs"
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Faculty List */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Faculty (Dept Admins)</h2>
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last Login</th>
            </tr>
          </thead>
          <tbody>
            {deptAdmins.map((admin) => {
              const a = admin as Record<string, unknown>;
              const dept = depts.find((d) => String((d as Record<string, unknown>)._id) === String(a.dept_id)) as Record<string, unknown> | undefined;
              return (
                <tr key={String(a._id)} className="border-b border-gray-700 hover:bg-gray-700/40">
                  <td className="px-4 py-3">
                    <p>{a.name as string}</p>
                    <p className="text-gray-500 text-xs">{a.email as string}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{dept?.name as string ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${a.status === 'active' ? 'text-green-400' : a.status === 'invited' ? 'text-yellow-400' : 'text-red-400'}`}>
                      {a.status as string}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {a.last_login ? new Date(a.last_login as string).toLocaleString() : 'Never'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
