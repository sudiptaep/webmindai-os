import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminUser {
  _id: string;
  name: string;
  email: string;
  college_id: string;
  dept_ids: string[];
  is_college_owner: boolean;
  status: string;
}

interface AuthState {
  token: string | null;
  user: AdminUser | null;
  collegeSlug: string;
  setAuth: (token: string, user: AdminUser, slug: string) => void;
  clearAuth: () => void;
  setCollegeSlug: (slug: string) => void;
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
    }),
    { name: 'admin-auth' }
  )
);
