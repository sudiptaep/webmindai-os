'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

type Tab = 'overview' | 'faculty' | 'students' | 'teaching';

export default function CollegeAdminAnalyticsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const analyticsQuery = trpc.collegeAdmin.getCrossDeptAnalytics.useQuery();
  const facultyQuery = trpc.collegeAdmin.getFacultyActivity.useQuery();
  const teachingQuery = trpc.teachingAnalytics.crossDept.useQuery({ days: 30 }, { enabled: tab === 'teaching' });

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Analytics</h1>

      <div className="flex border-b border-gray-700 mb-6">
        {(['overview', 'faculty', 'students', 'teaching'] as Tab[]).map((t) => (
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

      {tab === 'teaching' && (
        <div>
          {teachingQuery.isLoading && <p className="text-gray-400 text-sm">Loading…</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="pb-2 pr-4">Department</th>
                <th className="pb-2 pr-4 text-right">Sessions (30d)</th>
                <th className="pb-2 pr-4 text-right">Concepts taught</th>
                <th className="pb-2 pr-4 text-right">Backtrack rate</th>
                <th className="pb-2 pr-4 text-right">Hotspots</th>
                <th className="pb-2">Top concept</th>
              </tr>
            </thead>
            <tbody>
              {(teachingQuery.data?.departments ?? []).map((d) => (
                <tr key={d.dept_id} className="border-b border-gray-800">
                  <td className="py-2 pr-4">{d.dept_name}</td>
                  <td className="py-2 pr-4 text-right text-gray-300">{d.total_sessions}</td>
                  <td className="py-2 pr-4 text-right text-gray-300">{d.concepts_taught}</td>
                  <td className={`py-2 pr-4 text-right ${d.overall_backtrack_rate >= 0.3 ? 'text-amber-400' : 'text-gray-300'}`}>
                    {Math.round(d.overall_backtrack_rate * 100)}%
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-300">{d.hotspot_count}</td>
                  <td className="py-2 text-gray-400">{d.top_concept ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {teachingQuery.data && teachingQuery.data.departments.length === 0 && (
            <p className="text-sm text-gray-500 mt-2">No teaching sessions across any department yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
