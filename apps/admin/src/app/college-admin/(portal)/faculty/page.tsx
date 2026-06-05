'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

export default function CollegeAdminFacultyPage() {
  const router = useRouter();
  const adminsQuery = trpc.collegeAdmin.listDeptAdmins.useQuery();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Faculty (Dept Admins)</h1>
        <button
          onClick={() => router.push('/college-admin/faculty/new')}
          className="bg-blue-600 hover:bg-blue-700 text-sm px-4 py-2 rounded text-white"
        >
          + Add Faculty
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Dept ID</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last Login</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {((adminsQuery.data as Record<string, unknown>[] | undefined) ?? []).map((admin) => (
              <tr key={String(admin._id)} className="border-b border-gray-700 hover:bg-gray-700/40">
                <td className="px-4 py-3">
                  <p>{admin.name as string}</p>
                  <p className="text-gray-500 text-xs">{admin.email as string}</p>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">{admin.dept_id as string}</td>
                <td className="px-4 py-3 text-gray-400">{admin.faculty_title as string ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${admin.status === 'active' ? 'text-green-400' : admin.status === 'invited' ? 'text-yellow-400' : 'text-red-400'}`}>
                    {admin.status as string}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {admin.last_login ? new Date(admin.last_login as string).toLocaleString() : 'Never'}
                </td>
                <td className="px-4 py-3 flex gap-2">
                  {admin.status === 'active' && (
                    <DeactivateButton adminId={String(admin._id)} onDone={() => adminsQuery.refetch()} />
                  )}
                  {admin.status === 'invited' && (
                    <ResendButton adminId={String(admin._id)} onDone={() => {}} />
                  )}
                </td>
              </tr>
            ))}
            {!adminsQuery.data?.length && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No dept admins added yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeactivateButton({ adminId, onDone }: { adminId: string; onDone: () => void }) {
  const mut = trpc.collegeAdmin.deactivateDeptAdmin.useMutation({ onSuccess: onDone });
  return (
    <button onClick={() => mut.mutate({ admin_id: adminId })} disabled={mut.isPending}
      className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50">
      Deactivate
    </button>
  );
}

function ResendButton({ adminId, onDone }: { adminId: string; onDone: () => void }) {
  const mut = trpc.collegeAdmin.resendDeptAdminInvite.useMutation({ onSuccess: onDone });
  return (
    <button onClick={() => mut.mutate({ admin_id: adminId })} disabled={mut.isPending}
      className="text-yellow-400 hover:text-yellow-300 text-xs disabled:opacity-50">
      Resend
    </button>
  );
}
