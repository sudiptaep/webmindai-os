const API = process.env.NEXT_PUBLIC_API_URL!;

export async function loginSuperAdmin(
  email: string,
  password: string
): Promise<{ token: string; user: Record<string, unknown> }> {
  const res = await fetch(`${API}/api/v1/auth/super-admin/login`, {
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

export async function logout(): Promise<void> {
  await fetch(`${API}/api/v1/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}
