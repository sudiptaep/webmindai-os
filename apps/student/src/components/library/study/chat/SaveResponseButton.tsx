'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';

const API = process.env.NEXT_PUBLIC_API_URL!;

interface Props {
  response: string;
  docId: string;
  collegeId: string;
  chapterIndex: number;
  sourcePage?: number;
}

export function SaveResponseButton({ response, docId, collegeId, chapterIndex, sourcePage }: Props) {
  const token = useAuthStore(s => s.token) ?? '';
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function handleSave() {
    if (status !== 'idle') return;
    setStatus('saving');

    try {
      const res = await fetch(
        `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIndex}/notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            content: '',
            source_page: sourcePage,
            pinned_ai_response: response,
          }),
        },
      );
      setStatus(res.ok ? 'saved' : 'error');
      if (res.ok) setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  }

  const label = status === 'saving' ? '…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Error' : 'Save';
  const cls = status === 'saved'
    ? 'text-teal-400'
    : status === 'error'
      ? 'text-red-400'
      : 'text-gray-500 hover:text-gray-300';

  return (
    <button
      onClick={handleSave}
      disabled={status !== 'idle'}
      className={`text-xs transition-colors ${cls}`}
      title="Save this response to notes"
    >
      {status === 'saved' ? '✓ ' : ''}Save to notes
    </button>
  );
}
