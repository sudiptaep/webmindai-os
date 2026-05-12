'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useChatStore } from '@/store/chat.store';
import { ChatWindow } from '@/components/ChatWindow';

export default function SessionChatPage({ params }: { params: { sessionId: string } }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { token, user } = useAuthStore();
  const { setSessionId, addMessage, reset } = useChatStore();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!token || !user) {
      router.replace('/login');
      return;
    }

    async function loadSession() {
      const API = process.env.NEXT_PUBLIC_API_URL!;
      try {
        const res = await fetch(
          `${API}/api/v1/college/${user!.college_id}/chat/sessions/${params.sessionId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
          }
        );
        if (!res.ok) {
          router.replace('/chat');
          return;
        }
        const session = await res.json();
        reset();
        setSessionId(session._id);
        for (const msg of session.messages ?? []) {
          addMessage({
            id: crypto.randomUUID(),
            role: msg.role,
            content: msg.content,
            sources: msg.sources,
            confidence_score: msg.confidence_score,
            answered: msg.answered,
          });
        }
      } catch {
        router.replace('/chat');
      }
    }

    loadSession();
  }, [mounted, token, user, params.sessionId, router, reset, setSessionId, addMessage]);

  if (!mounted || !token) return null;

  return (
    <div className="h-screen">
      <ChatWindow initialSessionId={params.sessionId} />
    </div>
  );
}
