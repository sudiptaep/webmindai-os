'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import type { SrsCard } from '@college-chatbot/shared';

const API = process.env.NEXT_PUBLIC_API_URL!;

export type { SrsCard };

export interface SRSStats {
  total_cards: number;
  active_cards: number;
  graduated_cards: number;
  due_today: number;
  streak: number;
  avg_ease_factor: number;
  retention_rate_pct: number;
}

export interface DueTodayResult {
  cards: SrsCard[];
  total_due: number;
  total_active: number;
  streak: number;
}

export function useSRSStats() {
  const { token, user } = useAuthStore();
  const [data, setData] = useState<SRSStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/college/${user.college_id}/student/srs/stats`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error('Failed to load SRS stats');
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

export function useDueTodayCards() {
  const { token, user } = useAuthStore();
  const [data, setData] = useState<DueTodayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/v1/college/${user.college_id}/student/srs/due-today`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error('Failed to load cards');
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

export async function submitReview(
  token: string,
  collegeId: string,
  cardId: string,
  quality: number,
  timeTakenSeconds: number,
): Promise<{ interval_days: number; streak: number }> {
  const res = await fetch(
    `${API}/api/v1/college/${collegeId}/student/srs/review`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        card_id: cardId,
        quality,
        time_taken_seconds: timeTakenSeconds,
        student_answer: '',
      }),
    },
  );
  if (!res.ok) throw new Error('Review submission failed');
  return res.json();
}

export async function suspendCard(token: string, collegeId: string, cardId: string): Promise<void> {
  await fetch(
    `${API}/api/v1/college/${collegeId}/student/srs/cards/${cardId}/suspend`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } },
  );
}

export async function deleteCard(token: string, collegeId: string, cardId: string): Promise<void> {
  await fetch(
    `${API}/api/v1/college/${collegeId}/student/srs/cards/${cardId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
}
