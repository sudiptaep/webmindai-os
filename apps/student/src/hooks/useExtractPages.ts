'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { submitExtractPages, pollExtractJob } from '@/lib/library';

type JobState = {
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  jobId: string | null;
  tokenUrl: string | null;
  expiresAt: string | null;
  error: string | null;
  estimatedSeconds: number;
};

const INITIAL: JobState = {
  status: 'idle', jobId: null, tokenUrl: null, expiresAt: null, error: null, estimatedSeconds: 8,
};

export function useExtractPages(collegeId: string, docId: string) {
  const { token } = useAuthStore();
  const [state, setState] = useState<JobState>(INITIAL);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  useEffect(() => () => { clearPoll(); }, []);

  const submit = useCallback(
    async (body: { pages?: number[]; page_from?: number; page_to?: number }) => {
      if (!token) return;
      setState({ ...INITIAL, status: 'pending' });
      try {
        const res = await submitExtractPages(collegeId, docId, body, token);
        setState(s => ({ ...s, jobId: res.job_id, estimatedSeconds: res.estimated_seconds ?? 8 }));

        intervalRef.current = setInterval(async () => {
          try {
            const poll = await pollExtractJob(collegeId, res.job_id, token!);
            if (poll.status === 'completed') {
              clearPoll();
              setState(s => ({
                ...s, status: 'completed',
                tokenUrl: poll.token_url ?? null,
                expiresAt: poll.expires_at ?? null,
              }));
            } else if (poll.status === 'failed') {
              clearPoll();
              setState(s => ({ ...s, status: 'failed', error: poll.error ?? 'Extraction failed' }));
            } else {
              setState(s => ({ ...s, status: poll.status as JobState['status'] }));
            }
          } catch {
            clearPoll();
            setState(s => ({ ...s, status: 'failed', error: 'Failed to poll job status' }));
          }
        }, 2000);

      } catch (e) {
        setState({ ...INITIAL, status: 'failed', error: e instanceof Error ? e.message : 'Failed to start extraction' });
      }
    },
    [token, collegeId, docId],
  );

  const reset = useCallback(() => { clearPoll(); setState(INITIAL); }, []);

  return { ...state, submit, reset };
}
