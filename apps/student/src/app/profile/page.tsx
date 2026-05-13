'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth.store';
import { logout } from '@/lib/auth';
import { AppShell, formatAcademicLevel } from '@/components/AppSidebar';

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-800/60 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm text-gray-200 text-right">{children}</span>
    </div>
  );
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  minLength,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        minLength={minLength}
        className="w-full bg-gray-900 border border-gray-700/60 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-teal-600/50 transition-colors"
      />
    </div>
  );
}

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

  useEffect(() => {
    if (profile?.name && !name) setName(profile.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.name]);

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
      setSuccess('Profile updated');
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

  const initials = (profile?.name ?? user?.name ?? '?').charAt(0).toUpperCase();
  const academicLabel = profile?.semester
    ? formatAcademicLevel(profile.semester, user?.college_type)
    : null;

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-6 pt-10 pb-16">

        {/* Avatar + name hero */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-20 h-20 rounded-full bg-teal-700 flex items-center justify-center text-3xl font-bold text-white mb-4 select-none">
            {initials}
          </div>
          <h1 className="text-2xl font-semibold text-gray-100">
            {profile?.name ?? user?.name ?? '—'}
          </h1>
          {academicLabel && (
            <p className="text-sm text-gray-500 mt-1">{academicLabel}</p>
          )}
        </div>

        {/* Account info card */}
        <div className="bg-gray-900/60 border border-gray-800/60 rounded-2xl px-5 py-1 mb-6">
          <InfoRow label="Email">
            <span className="flex items-center gap-2">
              {profile?.email ?? '—'}
              {profile?.email_verified ? (
                <span className="text-xs text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-full">Verified</span>
              ) : (
                <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">Unverified</span>
              )}
            </span>
          </InfoRow>
          <InfoRow label={isMedical ? 'Year' : 'Semester'}>
            {academicLabel ?? '—'}
          </InfoRow>
          {profile?.roll_number && (
            <InfoRow label="Roll No.">{profile.roll_number}</InfoRow>
          )}
          <InfoRow label="Status">
            <span className={profile?.status === 'active' ? 'text-teal-400' : 'text-red-400'}>
              {profile?.status ?? '—'}
            </span>
          </InfoRow>
        </div>

        {/* Edit form */}
        <form onSubmit={handleUpdate} className="bg-gray-900/60 border border-gray-800/60 rounded-2xl p-5 space-y-5 mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Edit Profile</p>

          <Field label="Display Name" value={name} onChange={setName} />

          <div className="border-t border-gray-800/60 pt-5 space-y-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Change Password</p>
            <Field
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <Field
              label="New Password"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              minLength={8}
            />
            <Field
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              minLength={8}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-2.5">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-teal-400 bg-teal-400/10 border border-teal-400/20 rounded-xl px-4 py-2.5">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={updateMutation.isPending || isLoading}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl py-2.5 text-sm font-medium text-white transition-colors cursor-pointer"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        {/* Sign out */}
        <button
          onClick={handleLogout}
          className="w-full border border-gray-800 hover:border-red-800/60 hover:bg-red-900/20 text-gray-500 hover:text-red-400 rounded-xl py-2.5 text-sm font-medium transition-colors cursor-pointer"
        >
          Sign out
        </button>

      </div>
    </AppShell>
  );
}
