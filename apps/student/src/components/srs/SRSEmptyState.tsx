'use client';

import Link from 'next/link';

interface SRSEmptyStateProps {
  streak: number;
}

export function SRSEmptyState({ streak }: SRSEmptyStateProps) {
  return (
    <div className="bg-[#151820] border border-gray-800/60 rounded-xl p-10 text-center space-y-3">
      <div className="text-4xl">✅</div>
      <h3 className="text-base font-semibold text-gray-100">All caught up!</h3>
      <p className="text-sm text-gray-500">
        No cards due for review right now.
        {streak > 0 && ` Your streak is ${streak} day${streak !== 1 ? 's' : ''} — keep it going!`}
      </p>
      <p className="text-xs text-gray-600">
        New cards are added automatically when you complete quizzes.
      </p>
      <div className="flex gap-3 justify-center pt-2">
        <Link
          href="/library"
          className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors"
        >
          Go to Library
        </Link>
        <Link
          href="/chat"
          className="px-4 py-2 rounded-lg border border-gray-700/60 text-gray-300 hover:text-gray-100 hover:bg-gray-800/60 text-sm transition-colors"
        >
          Start a Chat
        </Link>
      </div>
    </div>
  );
}
