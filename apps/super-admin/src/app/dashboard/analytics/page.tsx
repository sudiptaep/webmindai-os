'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

export default function PlatformAnalyticsPage() {
  const { token } = useAuthStore();
  const [selectedCollege, setSelectedCollege] = useState('');

  const { data: colleges } = trpc.college.list.useQuery(
    { limit: 100 },
    { enabled: !!token }
  );

  const { data: overview } = trpc.college.analyticsOverview.useQuery(
    undefined,
    { enabled: !!token }
  );

  const { data: collegeStats } = trpc.college.analyticsCollege.useQuery(
    { college_id: selectedCollege },
    { enabled: !!selectedCollege && !!token }
  );

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Platform Analytics</h1>

      {overview && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard label="Total colleges" value={overview.total} />
          <StatCard label="Active" value={overview.active} />
          <StatCard label="Suspended" value={overview.suspended} />
        </div>
      )}

      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <h2 className="text-sm font-medium mb-3 text-gray-300">College drill-down</h2>
        <select
          value={selectedCollege}
          onChange={(e) => setSelectedCollege(e.target.value)}
          className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm mb-4 focus:outline-none focus:border-blue-500"
        >
          <option value="">Select a college…</option>
          {colleges?.colleges?.map((c: { _id: string; name: string }) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>

        {collegeStats && (
          <div className="grid grid-cols-3 gap-3">
            <SmallStat label="Departments" value={collegeStats.deptCount} />
            <SmallStat label="Students" value={collegeStats.studentCount} />
            <SmallStat label="Documents" value={collegeStats.docCount} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-900 border border-gray-700 rounded p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  );
}
