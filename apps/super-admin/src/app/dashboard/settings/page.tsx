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
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Account Settings</h1>

      {/* Read-only info */}
      <div className="bg-card rounded-lg p-4 mb-6 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Email</span>
          <span>{profile?.email}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Role</span>
          <span className="text-primary">Super Admin</span>
        </div>
      </div>

      {/* Edit form */}
      <form onSubmit={handleUpdate} className="bg-card rounded-lg p-4 space-y-4">
        <h2 className="font-semibold text-sm text-foreground uppercase tracking-wide">
          Update Profile
        </h2>
        <div>
          <label className="block text-sm mb-1 text-muted-foreground">Display Name</label>
          <input
            type="text"
            value={name || profile?.name || ''}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div className="border-t border-border pt-4">
          <h3 className="text-sm text-muted-foreground mb-3">Change Password (optional)</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm mb-1 text-muted-foreground">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-muted-foreground">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-muted-foreground">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                className="w-full bg-muted border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
        {success && <p className="text-green-700 dark:text-green-400 text-sm">{success}</p>}

        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded py-2 text-sm font-medium transition-colors"
        >
          {updateMutation.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}
