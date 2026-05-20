'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';

const API = process.env.NEXT_PUBLIC_API_URL!;

export interface MyYearDoc {
  doc_id: string;
  filename: string;
  file_type: string;
  has_chapter_map: boolean;
  chapter_count: number;
  page_count: number;
}

export interface MyYearSubject {
  subject_id: string;
  name: string;
  code: string;
  year: number;
  semester: number;
  dept_id: string;
  disease_tags: string[];
  doc_count: number;
  docs: MyYearDoc[];
}

export interface MyYearData {
  student_year: number;
  student_semester: number;
  subjects: MyYearSubject[];
  total_subjects: number;
  total_docs: number;
  srs_cards_due_today: number;
  study_streak: number;
}

export function useMyYear() {
  const { token, user } = useAuthStore();
  const [data, setData] = useState<MyYearData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/college/${user.college_id}/student/my-year`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error('Failed to load year view');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
