'use client';

import { type ChatMode } from '@/lib/library';

interface Props {
  mode: ChatMode | undefined;
  onSwitch: (mode: ChatMode) => void;
}

export function SocraticToggle({ mode, onSwitch }: Props) {
  const isAnswer   = !mode || mode === 'answer';
  const isSocratic = mode === 'socratic';

  return (
    <div className="flex items-center gap-1 bg-gray-800/80 rounded-lg p-0.5 border border-gray-700">
      <button
        onClick={() => onSwitch('answer')}
        className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
          isAnswer
            ? 'bg-teal-700 text-white'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        Answer
      </button>
      <button
        onClick={() => onSwitch('socratic')}
        className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
          isSocratic
            ? 'bg-violet-700 text-white'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        Teach me
      </button>
    </div>
  );
}
