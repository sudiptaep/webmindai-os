'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

export default function Home() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!token) {
      router.replace('/dept-admin/login');
    } else if (user?.role === 'college_admin') {
      router.replace('/college-admin/dashboard');
    } else {
      router.replace('/dept-admin/dashboard');
    }
  }, [token, user, router]);

  return null;
}
