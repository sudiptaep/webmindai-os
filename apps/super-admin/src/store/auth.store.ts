import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SuperAdminUser {
  _id: string;
  name: string;
  email: string;
}

interface AuthState {
  token: string | null;
  user: SuperAdminUser | null;
  setAuth: (token: string, user: SuperAdminUser) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
    }),
    { name: 'super-admin-auth' }
  )
);
