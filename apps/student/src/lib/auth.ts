const API = process.env.NEXT_PUBLIC_API_URL!;

export async function refreshAccessToken(): Promise<string> {
  const res = await fetch(`${API}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Session expired');
  const data = await res.json();
  return (data as { accessToken: string }).accessToken;
}

export async function loginStudent(
  email: string,
  password: string,
  collegeSlug: string
): Promise<{ token: string; user: Record<string, unknown> }> {
  const res = await fetch(
    `${API}/api/v1/auth/student/login?college_slug=${collegeSlug}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Login failed');
  }
  const data = await res.json();
  return { token: data.accessToken, user: data.user };
}

export async function registerStudent(
  data: { name: string; email: string; password: string; dept_id?: string; roll_number?: string; semester?: number },
  collegeSlug: string
): Promise<{ status: string; message: string }> {
  const res = await fetch(
    `${API}/api/v1/auth/student/register?college_slug=${collegeSlug}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Registration failed');
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${API}/api/v1/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}
