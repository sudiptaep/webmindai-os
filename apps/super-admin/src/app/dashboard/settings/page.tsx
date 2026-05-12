'use client';

import { useState, FormEvent } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth.store';

export default function SettingsPage() {
  const { token } = useAuthStore();

  const { data: profile, isLoading } = trpc.settings.getProfile.useQuery(undefined, {
    enabled: !!token,
  });

  const updateMutation = trpc.settings.updateProfile.useMutation();

  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Account Settings</h1>

      {/* Read-only info */}
      <div className="bg-gray-900 rounded-lg p-4 mb-6 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Email</span>
          <span>{profile?.email}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Role</span>
          <span className="text-blue-400">Super Admin</span>
        </div>
      </div>

      {/* Edit form */}
      <form onSubmit={handleUpdate} className="bg-gray-900 rounded-lg p-4 space-y-4">
        <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wide">
          Update Profile
        </h2>
        <div>
          <label className="block text-sm mb-1 text-gray-400">Display Name</label>
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
    </div>
  );
}
