'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

export default function CollegeDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { token } = useAuthStore();

  const { data: college, isLoading, refetch } = trpc.college.get.useQuery(
    { id: params.id },
    { enabled: !!token }
  );

  const { data: depts, refetch: refetchDepts } = trpc.department.list.useQuery(
    { college_id: params.id },
    { enabled: !!token }
  );

  const { data: stats } = trpc.college.analyticsCollege.useQuery(
    { college_id: params.id },
    { enabled: !!token }
  );

  const updateMut = trpc.college.update.useMutation({ onSuccess: () => refetch() });
  const deleteMut = trpc.college.delete.useMutation({
    onSuccess: () => router.push('/dashboard/colleges'),
  });
  const createDeptMut = trpc.department.create.useMutation({ onSuccess: () => refetchDepts() });
  const deleteDeptMut = trpc.department.delete.useMutation({ onSuccess: () => refetchDepts() });

  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptType, setDeptType] = useState<'engineering' | 'medical' | 'other'>('engineering');
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [addAdminEmail, setAddAdminEmail] = useState('');

  const addAdminMut = trpc.college.addAdmin.useMutation({ onSuccess: () => setAddAdminEmail('') });

  function handleAddDept(e: FormEvent) {
    e.preventDefault();
    createDeptMut.mutate({ college_id: params.id, name: deptName, code: deptCode, type: deptType });
    setDeptName(''); setDeptCode(''); setShowDeptForm(false);
  }

  if (isLoading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (!college) return <p className="text-gray-400 text-sm">College not found.</p>;

  return (
    <div className="max-w-3xl">
      <button onClick={() => router.back()} className="text-sm text-gray-400 hover:text-gray-100 mb-4">
        ← Back
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">{college.name}</h1>
          <p className="text-sm text-gray-400">{college.slug} · {college.type}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => updateMut.mutate({ id: params.id, status: college.status === 'active' ? 'suspended' : 'active' })}
            className={`text-sm px-3 py-1.5 rounded border transition-colors ${
              college.status === 'active'
                ? 'border-yellow-700 text-yellow-400 hover:bg-yellow-900/20'
                : 'border-green-700 text-green-400 hover:bg-green-900/20'
            }`}
          >
            {college.status === 'active' ? 'Suspend' : 'Activate'}
          </button>
          <button
            onClick={() => { if (confirm('Delete this college?')) deleteMut.mutate({ id: params.id }); }}
            className="text-sm px-3 py-1.5 rounded border border-red-700 text-red-400 hover:bg-red-900/20 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Stat label="Departments" value={stats.deptCount} />
          <Stat label="Students" value={stats.studentCount} />
          <Stat label="Documents" value={stats.docCount} />
        </div>
      )}

      {/* Departments */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300">Departments</h2>
          <button
            onClick={() => setShowDeptForm((v) => !v)}
            className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
          >
            {showDeptForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showDeptForm && (
          <form onSubmit={handleAddDept} className="bg-gray-800 border border-gray-700 rounded p-3 mb-3 flex gap-3">
            <input
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="Name"
              className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
              required
            />
            <input
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
              placeholder="Code"
              className="w-24 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
              required
            />
            <select
              value={deptType}
              onChange={(e) => setDeptType(e.target.value as 'engineering' | 'medical' | 'other')}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
            >
              <option value="engineering">Engineering</option>
              <option value="medical">Medical</option>
              <option value="general">General</option>
            </select>
            <button type="submit" className="text-xs bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded">
              Add
            </button>
          </form>
        )}

        <div className="space-y-1.5">
          {depts?.map((d: { _id: string; name: string; code: string; is_generic?: boolean }) => (
            <div key={d._id} className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded px-3 py-2">
              <div className="flex-1">
                <span className="text-sm">{d.name}</span>
                {d.is_generic && (
                  <span className="ml-2 text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">generic</span>
                )}
              </div>
              <span className="text-xs text-gray-500">{d.code}</span>
              {!d.is_generic && (
                <button
                  onClick={() => deleteDeptMut.mutate({ college_id: params.id, dept_id: d._id })}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Add Admin */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Add Department Admin</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addAdminMut.mutate({ college_id: params.id, email: addAdminEmail });
          }}
          className="flex gap-2"
        >
          <input
            type="email"
            value={addAdminEmail}
            onChange={(e) => setAddAdminEmail(e.target.value)}
            placeholder="admin@college.edu"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            required
          />
          <button
            type="submit"
            disabled={addAdminMut.isPending}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded text-sm"
          >
            {addAdminMut.isPending ? 'Sending…' : 'Invite'}
          </button>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  );
}
