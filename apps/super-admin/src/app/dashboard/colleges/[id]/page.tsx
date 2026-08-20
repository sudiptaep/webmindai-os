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

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!college) return <p className="text-muted-foreground text-sm">College not found.</p>;

  return (
    <div className="max-w-3xl">
      <button onClick={() => router.back()} className="text-sm text-muted-foreground hover:text-foreground mb-4">
        ← Back
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">{college.name}</h1>
          <p className="text-sm text-muted-foreground">{college.slug} · {college.type}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => updateMut.mutate({ id: params.id, status: college.status === 'active' ? 'suspended' : 'active' })}
            className={`text-sm px-3 py-1.5 rounded border transition-colors ${
              college.status === 'active'
                ? 'border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-900/20'
                : 'border-green-700 text-green-700 dark:text-green-400 hover:bg-green-100 dark:bg-green-900/20'
            }`}
          >
            {college.status === 'active' ? 'Suspend' : 'Activate'}
          </button>
          <button
            onClick={() => { if (confirm('Delete this college?')) deleteMut.mutate({ id: params.id }); }}
            className="text-sm px-3 py-1.5 rounded border border-red-300 dark:border-red-700 text-destructive hover:bg-red-900/20 transition-colors"
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
          <h2 className="text-sm font-semibold text-foreground">Departments</h2>
          <button
            onClick={() => setShowDeptForm((v) => !v)}
            className="text-xs bg-accent hover:bg-accent px-2 py-1 rounded"
          >
            {showDeptForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {showDeptForm && (
          <form onSubmit={handleAddDept} className="bg-muted border border-border rounded p-3 mb-3 flex gap-3">
            <input
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="Name"
              className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
              required
            />
            <input
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value)}
              placeholder="Code"
              className="w-24 bg-card border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
              required
            />
            <select
              value={deptType}
              onChange={(e) => setDeptType(e.target.value as 'engineering' | 'medical' | 'other')}
              className="bg-card border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-primary"
            >
              <option value="engineering">Engineering</option>
              <option value="medical">Medical</option>
              <option value="other">Other</option>
            </select>
            <button type="submit" className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1 rounded">
              Add
            </button>
          </form>
        )}

        <div className="space-y-1.5">
          {depts?.map((d: { _id: string; name: string; code: string; is_generic?: boolean }) => (
            <div key={d._id} className="flex items-center gap-3 bg-muted border border-border rounded px-3 py-2">
              <div className="flex-1">
                <span className="text-sm">{d.name}</span>
                {d.is_generic && (
                  <span className="ml-2 text-xs bg-accent text-muted-foreground px-1.5 py-0.5 rounded">generic</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{d.code}</span>
              {!d.is_generic && (
                <button
                  onClick={() => deleteDeptMut.mutate({ college_id: params.id, dept_id: d._id })}
                  className="text-xs text-destructive hover:text-red-700 dark:hover:text-red-300"
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
        <h2 className="text-sm font-semibold text-foreground mb-3">Add Department Admin</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const collegeId = Array.isArray(params.id) ? params.id[0] : params.id;
            
            if (collegeId) {
              addAdminMut.mutate({
                college_id: collegeId, email: addAdminEmail,
                dept_id: ''
              });
            }
          }}
          className="flex gap-2"
        >
          <input
            type="email"
            value={addAdminEmail}
            onChange={(e) => setAddAdminEmail(e.target.value)}
            placeholder="admin@college.edu"
            className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
            required
          />
          <button
            type="submit"
            disabled={addAdminMut.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 px-4 py-2 rounded text-sm"
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
    <div className="bg-muted border border-border rounded p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  );
}
