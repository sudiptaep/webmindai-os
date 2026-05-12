'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { LibraryLayout } from '@/components/library/LibraryLayout';

export default function LibraryPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const token = useAuthStore(s => s.token);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!token) router.replace('/login');
  }, [mounted, token, router]);

  if (!mounted || !token) return null;

  return <LibraryLayout />;
}
