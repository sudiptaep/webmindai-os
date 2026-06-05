const API = process.env.NEXT_PUBLIC_API_URL!;

export type LoginRole = 'dept_admin' | 'college_admin';

export async function loginAdmin(
  email: string,
  password: string,
  collegeSlug: string,
  role: LoginRole = 'dept_admin',
): Promise<{ token: string; user: Record<string, unknown> }> {
  const endpoint = role === 'college_admin'
    ? `/api/v1/auth/college-admin/login?college_slug=${collegeSlug}`
    : `/api/v1/auth/dept-admin/login?college_slug=${collegeSlug}`;

  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Login failed');
  }
  const data = await res.json();
  return { token: data.accessToken, user: data.user };
}

export async function acceptInvite(
  token: string,
  password: string,
  collegeSlug: string,
  role: LoginRole,
): Promise<{ token: string; user: Record<string, unknown> }> {
  const endpoint = role === 'college_admin'
    ? '/api/v1/auth/college-admin/accept-invite'
    : '/api/v1/auth/dept-admin/accept-invite';

  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token, password, college_slug: collegeSlug }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Failed to accept invite');
  }
  const data = await res.json();
  return { token: data.accessToken, user: data.user };
}

export async function forgotPassword(
  email: string,
  collegeSlug: string,
  role: LoginRole,
): Promise<void> {
  const endpoint = role === 'college_admin'
    ? '/api/v1/auth/college-admin/forgot-password'
    : '/api/v1/auth/dept-admin/forgot-password';

  await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, college_slug: collegeSlug }),
  });
}

export async function resetPassword(
  token: string,
  newPassword: string,
  role: LoginRole,
): Promise<void> {
  const endpoint = role === 'college_admin'
    ? '/api/v1/auth/college-admin/reset-password'
    : '/api/v1/auth/dept-admin/reset-password';

  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Reset failed');
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API}/api/v1/auth/logout`, { method: 'POST', credentials: 'include' });
}
