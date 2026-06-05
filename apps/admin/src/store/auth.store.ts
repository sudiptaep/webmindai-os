import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AdminUser {
  _id: string;
  name: string;
  email: string;
  role: 'college_admin' | 'dept_admin';
  college_id: string;
  college_slug?: string;
  // dept_admin fields
  dept_id?: string;
  dept_name?: string;
  faculty_title?: string;
  permissions?: Record<string, boolean>;
  // college_admin fields
  admin_title?: string;
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
    { name: 'admin-auth' },
  ),
);
