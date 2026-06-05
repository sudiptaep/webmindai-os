'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export default function CollegeAdminStudentsPage() {
  const [page, setPage] = useState(1);
  const [dept_id, setDeptId] = useState('');

  const deptsQuery = trpc.collegeAdmin.listDepartments.useQuery();
  const studentsQuery = trpc.collegeAdmin.listStudents.useQuery({ dept_id: dept_id || undefined, page, limit: 30 });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Students</h1>
        <div className="flex gap-2">
          <select value={dept_id} onChange={(e) => { setDeptId(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm">
            <option value="">All departments</option>
            {(deptsQuery.data ?? []).filter((d) => !d.is_generic).map((d) => (
              <option key={String(d._id)} value={String(d._id)}>{d.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Dept</th>
              <th className="px-4 py-3">Semester</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {(studentsQuery.data?.students as Record<string, unknown>[] ?? []).map((s) => (
              <tr key={String(s._id)} className="border-b border-gray-700 hover:bg-gray-700/40">
                <td className="px-4 py-3">
                  <p>{s.name as string}</p>
                  <p className="text-gray-500 text-xs">{s.email as string}</p>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{s.dept_id as string}</td>
                <td className="px-4 py-3 text-gray-400">Sem {s.semester as number}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${s.status === 'active' ? 'text-green-400' : s.status === 'pending_approval' ? 'text-yellow-400' : 'text-red-400'}`}>
                    {s.status as string}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(s.created_at as string).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {!studentsQuery.data?.students?.length && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No students found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {studentsQuery.data && studentsQuery.data.total > 30 && (
        <div className="flex justify-end gap-2 mt-4">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 text-sm border border-gray-700 rounded disabled:opacity-40">Previous</button>
          <span className="px-3 py-1 text-sm text-gray-400">
            Page {page} of {Math.ceil(studentsQuery.data.total / 30)}
          </span>
          <button disabled={page >= Math.ceil(studentsQuery.data.total / 30)} onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 text-sm border border-gray-700 rounded disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
