'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useChatStore } from '@/store/chat.store';
import { ChatWindow, type SubjectSuggestion } from '@/components/ChatWindow';

const API = process.env.NEXT_PUBLIC_API_URL!;

export default function NewChatPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [subjects, setSubjects] = useState<SubjectSuggestion[]>([]);

  const token = useAuthStore((s) => s.token);
  const user  = useAuthStore((s) => s.user);
  const reset = useChatStore((s) => s.reset);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!token) { router.replace('/login'); return; }
    reset();
  }, [mounted, token, router, reset]);

  // Fetch subject suggestions once mounted + authenticated
  useEffect(() => {
    if (!mounted || !token || !user?.college_id) return;

    fetch(`${API}/api/v1/college/${user.college_id}/chat/suggestions`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { subjects?: SubjectSuggestion[] } | null) => {
        if (data?.subjects) setSubjects(data.subjects);
      })
      .catch(() => {});
  }, [mounted, token, user]);

  if (!mounted || !token) return null;

  return (
    <div className="h-screen">
      <ChatWindow subjects={subjects} />
    </div>
  );
}
