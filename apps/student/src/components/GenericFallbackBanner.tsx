'use client';

import { trpc } from '@/lib/trpc';
import { useAuthStore } from '@/store/auth.store';

export function GenericFallbackBanner() {
  const user = useAuthStore((s) => s.user);
  const utils = trpc.useUtils();
  const setFallback = trpc.student.setDeptFallback.useMutation({
    onSuccess: () => utils.student.profile.invalidate(),
  });

  if (!user?.using_generic_fallback) return null;

  return (
    <div className="bg-amber-900/40 border border-amber-700 rounded-lg px-4 py-2 text-sm text-amber-300 flex items-center justify-between gap-4">
      <span>
        Your department has no content yet — answers come from the General knowledge base.
      </span>
      <button
        onClick={() => setFallback.mutate({ use_fallback: false })}
        className="shrink-0 text-xs underline hover:text-amber-100"
      >
        Disable fallback
      </button>
    </div>
  );
}
