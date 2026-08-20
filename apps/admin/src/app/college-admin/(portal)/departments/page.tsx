'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

export default function CollegeAdminDepartmentsPage() {
  const router = useRouter();
  const deptsQuery = trpc.collegeAdmin.listDepartments.useQuery();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">Departments</h1>
      {deptsQuery.isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
      <div className="bg-muted rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-left">
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(deptsQuery.data ?? []).filter((d) => !d.is_generic).map((dept) => (
              <tr key={String(dept._id)} className="border-b border-border hover:bg-accent/40">
                <td className="px-4 py-3 font-medium">{dept.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{dept.code}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">{dept.type}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => router.push(`/college-admin/departments/${String(dept._id)}`)}
                    className="text-primary hover:text-blue-300 text-xs"
                  >
                    View →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
