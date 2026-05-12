'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { LibraryLayout } from '@/components/library/LibraryLayout';

export default function DocDeepLinkPage() {
  const router = useRouter();
  const { docId } = useParams() as { docId: string };
  const searchParams = useSearchParams();
  const page = searchParams.get('page') ? Number(searchParams.get('page')) : undefined;
  const [mounted, setMounted] = useState(false);
  const token = useAuthStore(s => s.token);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!token) router.replace('/login');
  }, [mounted, token, router]);

  if (!mounted || !token) return null;

  return <LibraryLayout initialDocId={docId} initialPage={page} />;
}
