'use client';

import { useState, useMemo, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

interface Student {
  _id: string;
  name: string;
  email: string;
  roll_number?: string;
  semester: number;
  dept_id: string;
  status: string;
  using_generic_fallback?: boolean;
}

export default function StudentsPage() {
  const { token, user } = useAuthStore();
  const collegeId = user?.college_id ?? '';
  const [filterDeptId, setFilterDeptId] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [tab, setTab] = useState<'active' | 'pending' | 'disabled'>('active');

  const { data: college } = trpc.college.getOwn.useQuery(undefined, {
    enabled: !!collegeId && !!token,
  });
  const { data: depts } = trpc.department.listOwn.useQuery(undefined, {
    enabled: !!collegeId && !!token,
  });

  const isMedical = college?.type === 'medical';
  const yearLabel = isMedical ? 'Year' : 'Semester';

  const { data, isLoading, isError, error, refetch } = trpc.student.list.useQuery(
    { status: tab === 'pending' ? 'pending_approval' : tab, page: 1, limit: 1000 },
    { enabled: !!collegeId && !!token }
  );

  const { data: pendingData } = trpc.student.list.useQuery(
    { status: 'pending_approval', page: 1, limit: 1000 },
    { enabled: !!collegeId && !!token }
  );
  const pendingCount = pendingData?.total ?? 0;

  const setStatus = trpc.student.setStatus.useMutation({ onSuccess: () => refetch() });
  const deleteStudent = trpc.student.deleteStudent.useMutation({ onSuccess: () => refetch() });

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = useCallback((studentId: string) => {
    deleteStudent.mutate({ student_id: studentId });
    setConfirmDeleteId(null);
  }, [deleteStudent]);

  const allStudents: Student[] = (data?.students ?? []) as Student[];

  // Unique year values from data
  const years = useMemo(
    () => [...new Set(allStudents.map((s) => s.semester))].sort((a, b) => a - b),
    [allStudents]
  );

  const filtered = useMemo(() => {
    let list = allStudents;
    if (filterDeptId) list = list.filter((s) => s.dept_id === filterDeptId);
    if (filterYear) list = list.filter((s) => String(s.semester) === filterYear);
    return list;
  }, [allStudents, filterDeptId, filterYear]);

  const deptMap = useMemo(() => {
    const m: Record<string, string> = {};
    (depts ?? []).forEach((d) => { m[String(d._id)] = d.name; });
    return m;
  }, [depts]);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Students</h1>
          {!isLoading && (
            <p className="text-xs text-gray-500 mt-0.5">
              {filtered.length} of {allStudents.length} student{allStudents.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Dept filter — only show if >1 dept */}
          {depts && depts.length > 1 ? (
            <select
              value={filterDeptId}
              onChange={(e) => setFilterDeptId(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
            >
              <option value="">All Departments</option>
              {(depts ?? []).map((d) => (
                <option key={String(d._id)} value={String(d._id)}>{d.name}</option>
              ))}
            </select>
          ) : depts?.[0] ? (
            <span className="text-sm text-gray-400 px-2 py-1.5 bg-gray-800 rounded border border-gray-600">
              {depts[0].name}
            </span>
          ) : null}
          {/* Year/Semester filter */}
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            <option value="">All {yearLabel}s</option>
            {years.map((y) => (
              <option key={y} value={y}>{yearLabel} {y}</option>
            ))}
          </select>
          {(filterDeptId || filterYear) && (
            <button
              onClick={() => { setFilterDeptId(''); setFilterYear(''); }}
              className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1.5 border border-gray-600 rounded"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-700">
        {(['active', 'pending', 'disabled'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setFilterDeptId(''); setFilterYear(''); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-teal-500 text-teal-400'
                : 'border-transparent text-gray-400 hover:text-gray-100'
            }`}
          >
            {t === 'pending' ? (
              <span className="flex items-center gap-1.5">
                Pending Approval
                {pendingCount > 0 && (
                  <span className="bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full">
                    {pendingCount}
                  </span>
                )}
              </span>
            ) : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Loading…</p>}

      {isError && (
        <p className="text-red-400 text-sm mb-4">
          Error: {(error as { message?: string })?.message ?? 'Failed to load students'}
          {!collegeId && ' — college_id missing from token, please re-login'}
        </p>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <p className="text-gray-500 text-sm">No {tab} students found.</p>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 text-gray-400 text-xs">
                <th className="text-left px-4 py-2.5 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Email</th>
                <th className="text-left px-4 py-2.5 font-medium">Roll No.</th>
                {(depts && depts.length > 1) && (
                  <th className="text-left px-4 py-2.5 font-medium">Department</th>
                )}
                <th className="text-left px-4 py-2.5 font-medium">{yearLabel}</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr
                  key={s._id}
                  className={`border-t border-gray-700 ${i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800'} hover:bg-gray-750 transition-colors`}
                >
                  <td className="px-4 py-2.5 font-medium">
                    {s.name}
                    {s.using_generic_fallback && (
                      <span className="ml-2 text-xs text-amber-400">fallback</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">{s.email}</td>
                  <td className="px-4 py-2.5 text-gray-400">{s.roll_number ?? '—'}</td>
                  {(depts && depts.length > 1) && (
                    <td className="px-4 py-2.5 text-gray-400">
                      {deptMap[s.dept_id] ?? '—'}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-gray-400">{yearLabel} {s.semester}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.status === 'active'
                        ? 'bg-green-900/40 text-green-400'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {tab === 'pending' ? (
                        <>
                          <button
                            onClick={() => setStatus.mutate({ student_id: s._id, status: 'active' })}
                            disabled={setStatus.isPending}
                            className="text-xs text-green-400 hover:text-green-300 px-2 py-1 border border-green-700 rounded"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setStatus.mutate({ student_id: s._id, status: 'disabled' })}
                            disabled={setStatus.isPending}
                            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-800 rounded"
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() =>
                            setStatus.mutate({
                              student_id: s._id,
                              status: s.status === 'active' ? 'disabled' : 'active',
                            })
                          }
                          className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1 border border-gray-600 rounded"
                        >
                          {s.status === 'active' ? 'Disable' : 'Activate'}
                        </button>
                      )}

                      {confirmDeleteId === s._id ? (
                        <span className="flex items-center gap-1">
                          <span className="text-xs text-red-400">Sure?</span>
                          <button
                            onClick={() => handleDelete(s._id)}
                            disabled={deleteStudent.isPending}
                            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-700 rounded"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1 border border-gray-600 rounded"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(s._id)}
                          className="text-xs text-red-500 hover:text-red-400 px-2 py-1 border border-red-800 rounded"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
