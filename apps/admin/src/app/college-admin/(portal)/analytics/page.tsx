'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

type Tab = 'overview' | 'faculty' | 'students';

export default function CollegeAdminAnalyticsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const analyticsQuery = trpc.collegeAdmin.getCrossDeptAnalytics.useQuery();
  const facultyQuery = trpc.collegeAdmin.getFacultyActivity.useQuery();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Analytics</h1>

      <div className="flex border-b border-gray-700 mb-6">
        {(['overview', 'faculty', 'students'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px capitalize ${tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          {analyticsQuery.isLoading && <p className="text-gray-400 text-sm">Loading…</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(analyticsQuery.data?.departments ?? []).map((dept) => (
              <div key={dept.dept_id} className="bg-gray-800 rounded-lg p-4">
                <p className="font-medium">{dept.dept_name}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-400">Documents:</span> <span>{dept.document_count}</span></div>
                  <div><span className="text-gray-400">Students:</span> <span>{dept.student_count}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'faculty' && (
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="pb-2 pr-4">Faculty</th>
                <th className="pb-2 pr-4">Department</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Last Login</th>
              </tr>
            </thead>
            <tbody>
              {(facultyQuery.data as Record<string, unknown>[] ?? []).map((f) => (
                <tr key={String(f._id)} className="border-b border-gray-800">
                  <td className="py-2 pr-4">{f.name as string}</td>
                  <td className="py-2 pr-4 text-gray-400">{f.dept_name as string}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs ${f.status === 'active' ? 'text-green-400' : 'text-yellow-400'}`}>
                      {f.status as string}
                    </span>
                  </td>
                  <td className="py-2 text-gray-400 text-xs">
                    {f.last_login ? new Date(f.last_login as string).toLocaleString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'students' && (
        <div className="text-gray-400 text-sm">
          <p>Go to Students tab for student overview.</p>
        </div>
      )}
    </div>
  );
}
