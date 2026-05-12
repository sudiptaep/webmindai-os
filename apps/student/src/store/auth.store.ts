import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { refreshAccessToken } from '@/lib/auth';

interface StudentUser {
  _id: string;
  name: string;
  email: string;
  college_id: string;
  college_type: 'engineering' | 'medical' | 'other';
  dept_id: string;
  effective_dept_id: string;
  using_generic_fallback: boolean;
  semester: number;
  status: string;
}

interface AuthState {
  token: string | null;
  user: StudentUser | null;
  collegeSlug: string;
  setAuth: (token: string, user: StudentUser, slug: string) => void;
  clearAuth: () => void;
  setCollegeSlug: (slug: string) => void;
  refreshToken: () => Promise<string>;
}

// Fallback: if college_type missing from persisted user (pre-fix sessions),
// decode it from the JWT payload.
export function selectCollegeType(s: AuthState): string | undefined {
  if (s.user?.college_type) return s.user.college_type;
  if (s.token) {
    try {
      return (JSON.parse(atob(s.token.split('.')[1])) as { college_type?: string }).college_type;
    } catch { return undefined; }
  }
  return undefined;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      collegeSlug: '',
      setAuth: (token, user, slug) => set({ token, user, collegeSlug: slug }),
      clearAuth: () => set({ token: null, user: null }),
      setCollegeSlug: (slug) => set({ collegeSlug: slug }),
      refreshToken: async () => {
        const newToken = await refreshAccessToken();
        set((s) => ({ ...s, token: newToken }));
        return newToken;
      },
    }),
    { name: 'student-auth' }
  )
);
