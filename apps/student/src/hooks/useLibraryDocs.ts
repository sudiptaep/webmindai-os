'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { fetchLibrary, type LibraryResponse, type LibraryParams } from '@/lib/library';

export function useLibraryDocs(params: LibraryParams = {}) {
  const { token, user } = useAuthStore();
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paramsKey = JSON.stringify(params);

  const load = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLibrary(user.college_id, token, params);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load library');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, paramsKey]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
