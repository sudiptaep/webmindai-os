'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';

export default function ProfilePage() {
  const router = useRouter();
  const { user, token, clearAuth } = useAuthStore();
  const isMedical = user?.college_type === 'medical';

  const { data: profile, isLoading } = trpc.student.profile.useQuery(undefined, {
    enabled: !!token,
  });

  const updateMutation = trpc.student.updateProfile.useMutation();

  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const sendVerificationMutation = { mutateAsync: async () => {} }; // placeholder

  // Populate name from profile when loaded
  const displayName = name || profile?.name || '';

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword && newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    const payload: { name?: string; current_password?: string; new_password?: string } = {};
    if (name && name !== profile?.name) payload.name = name;
    if (newPassword) {
      payload.current_password = currentPassword;
      payload.new_password = newPassword;
    }

    if (Object.keys(payload).length === 0) {
      setError('No changes to save');
      return;
    }

    try {
      await updateMutation.mutateAsync(payload);
      setSuccess('Profile updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function handleLogout() {
    await logout().catch(() => {});
    clearAuth();
    router.replace('/login');
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Profile</h1>
          <button
            onClick={() => router.back()}
            className="text-gray-400 hover:text-white text-sm"
          >
            ← Back
          </button>
        </div>

        {/* Info card */}
        <div className="bg-gray-900 rounded-lg p-4 mb-6 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Email</span>
            <span className="flex items-center gap-2">
              {profile?.email}
              {profile?.email_verified ? (
                <span className="text-green-400 text-xs">✓ Verified</span>
              ) : (
                <span className="text-yellow-400 text-xs">Unverified</span>
              )}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">{isMedical ? 'Year' : 'Semester'}</span>
            <span>{isMedical ? `Year ${profile?.semester}` : `Sem ${profile?.semester}`}</span>
          </div>
          {profile?.roll_number && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Roll No.</span>
              <span>{profile.roll_number}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Status</span>
            <span className={profile?.status === 'active' ? 'text-green-400' : 'text-red-400'}>
              {profile?.status}
            </span>
          </div>
        </div>

        {/* Edit form */}
        <form onSubmit={handleUpdate} className="bg-gray-900 rounded-lg p-4 space-y-4">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wide">
            Update Profile
          </h2>
          <div>
            <label className="block text-sm mb-1 text-gray-400">Name</label>
            <input
              type="text"
              value={name || profile?.name || ''}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="border-t border-gray-800 pt-4">
            <h3 className="text-sm text-gray-400 mb-3">Change Password (optional)</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1 text-gray-400">Current Password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-400">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-400">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {success && <p className="text-green-400 text-sm">{success}</p>}

          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded py-2 text-sm font-medium transition-colors"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <button
          onClick={handleLogout}
          className="mt-6 w-full border border-red-800 hover:bg-red-900/30 text-red-400 rounded py-2 text-sm font-medium transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
