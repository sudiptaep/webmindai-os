'use client';

import { useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { InviteStatusBadge } from '@/components/users/InviteStatusBadge';

export default function EditDeptAdminPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const adminId = String(params.adminId);
  const collegeId = searchParams.get('college_id') ?? '';

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const adminQuery = trpc.superAdminUsers.getDeptAdmin.useQuery(
    { admin_id: adminId, college_id: collegeId },
    { enabled: !!adminId && !!collegeId },
  );
  const activityQuery = trpc.superAdminUsers.getDeptAdminActivityLog.useQuery(
    { admin_id: adminId, college_id: collegeId },
    { enabled: !!adminId && !!collegeId },
  );

  const updateMutation = trpc.superAdminUsers.updateDeptAdmin.useMutation({
    onSuccess: () => { setSuccess('Saved.'); adminQuery.refetch(); },
    onError: (e) => setError(e.message),
  });
  const deactivateMutation = trpc.superAdminUsers.deactivateDeptAdmin.useMutation({
    onSuccess: () => adminQuery.refetch(), onError: (e) => setError(e.message),
  });
  const reactivateMutation = trpc.superAdminUsers.reactivateDeptAdmin.useMutation({
    onSuccess: () => adminQuery.refetch(), onError: (e) => setError(e.message),
  });
  const resetPasswordMutation = trpc.superAdminUsers.resetDeptAdminPassword.useMutation({
    onSuccess: () => setSuccess('Password reset email sent.'), onError: (e) => setError(e.message),
  });
  const resendInviteMutation = trpc.superAdminUsers.resendDeptAdminInvite.useMutation({
    onSuccess: () => setSuccess('Invitation resent.'), onError: (e) => setError(e.message),
  });
  const deleteMutation = trpc.superAdminUsers.deleteDeptAdmin.useMutation({
    onSuccess: () => router.push('/dashboard/users'),
    onError: (e) => setError(e.message),
  });
  const impersonateMutation = trpc.superAdminUsers.impersonateDeptAdmin.useMutation({
    onSuccess: (data) => {
      window.open(
        `${process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3002'}/dept-admin/dashboard?impersonation_token=${data.token}`,
        '_blank',
      );
    },
    onError: (e) => setError(e.message),
  });

  const admin = adminQuery.data as Record<string, unknown> | undefined;
  if (adminQuery.isLoading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (!admin) return <p className="text-red-400 text-sm">Admin not found.</p>;

  function togglePermission(key: string, value: boolean) {
    updateMutation.mutate({ admin_id: adminId, college_id: collegeId, permissions: { [key]: value } as never });
  }

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-200 text-sm">← Back</button>
        <h1 className="text-xl font-semibold">Edit Dept Admin</h1>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
      {success && <p className="text-green-400 text-sm mb-3">{success}</p>}

      <div className="bg-gray-800 rounded-lg p-4 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium">{admin.name as string}</p>
            <p className="text-gray-400 text-sm">{admin.email as string}</p>
            {!!admin.faculty_title && <p className="text-gray-400 text-xs mt-0.5">{admin.faculty_title as string}</p>}

          </div>
          <InviteStatusBadge status={admin.status as string} />
        </div>
        <div className="mt-3 text-xs text-gray-500 space-y-1">
          <p>Last login: {admin.last_login ? new Date(admin.last_login as string).toLocaleString() : 'Never'}</p>
          <p>Login count: {admin.login_count as number}</p>
        </div>
      </div>

      {/* Permissions */}
      <div className="bg-gray-800 rounded-lg p-4 mb-4">
        <p className="text-sm font-medium mb-3">Permissions</p>
        <div className="space-y-2">
          {[
            ['can_upload_documents', 'Can upload documents'],
            ['can_delete_documents', 'Can delete documents'],
            ['can_manage_subjects', 'Can manage subjects'],
            ['can_view_student_list', 'Can view student list'],
            ['can_reset_student_passwords', 'Can reset student passwords'],
          ].map(([key, label]) => {
            const perms = (admin.permissions as Record<string, boolean>) ?? {};
            return (
              <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={perms[key] ?? false}
                  onChange={(e) => togglePermission(key, e.target.checked)} />
                {label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => resetPasswordMutation.mutate({ admin_id: adminId, college_id: collegeId })}
          disabled={resetPasswordMutation.isPending}
          className="px-3 py-1.5 text-sm border border-gray-700 rounded hover:bg-gray-700">
          Reset Password
        </button>
        {admin.status === 'invited' && (
          <button onClick={() => resendInviteMutation.mutate({ admin_id: adminId, college_id: collegeId })}
            disabled={resendInviteMutation.isPending}
            className="px-3 py-1.5 text-sm border border-yellow-700 text-yellow-400 rounded hover:bg-yellow-900/30">
            Resend Invite
          </button>
        )}
        {admin.status === 'active' && (
          <button onClick={() => deactivateMutation.mutate({ admin_id: adminId, college_id: collegeId })}
            disabled={deactivateMutation.isPending}
            className="px-3 py-1.5 text-sm border border-red-700 text-red-400 rounded hover:bg-red-900/30">
            Deactivate
          </button>
        )}
        {admin.status === 'disabled' && (
          <button onClick={() => reactivateMutation.mutate({ admin_id: adminId, college_id: collegeId })}
            disabled={reactivateMutation.isPending}
            className="px-3 py-1.5 text-sm border border-green-700 text-green-400 rounded hover:bg-green-900/30">
            Reactivate
          </button>
        )}
        {process.env.NEXT_PUBLIC_IMPERSONATION_ENABLED === 'true' && admin.status === 'active' && (
          <button onClick={() => impersonateMutation.mutate({ admin_id: adminId, college_id: collegeId })}
            disabled={impersonateMutation.isPending}
            className="px-3 py-1.5 text-sm border border-purple-700 text-purple-400 rounded hover:bg-purple-900/30">
            Impersonate
          </button>
        )}
        <button
          onClick={() => {
            if (confirm(`Permanently delete ${admin.name as string}? This cannot be undone.`)) {
              deleteMutation.mutate({ admin_id: adminId, college_id: collegeId });
            }
          }}
          disabled={deleteMutation.isPending}
          className="px-3 py-1.5 text-sm border border-red-800 text-red-500 rounded hover:bg-red-950 ml-auto"
        >
          {deleteMutation.isPending ? 'Deleting…' : 'Delete User'}
        </button>
      </div>

      {/* Activity Log */}
      <div>
        <p className="text-sm font-medium mb-2">Recent Activity</p>
        <div className="space-y-1">
          {activityQuery.data?.logs.map((log) => (
            <div key={String((log as Record<string, unknown>)._id)} className="text-xs text-gray-400 flex gap-2">
              <span className="text-gray-600">{new Date(String((log as Record<string, unknown>).created_at)).toLocaleString()}</span>
              <span>{String((log as Record<string, unknown>).action).replace(/_/g, ' ')} — {String((log as Record<string, unknown>).target_name)}</span>
            </div>
          ))}
          {!activityQuery.data?.logs.length && <p className="text-xs text-gray-600">No activity recorded.</p>}
        </div>
      </div>
    </div>
  );
}
