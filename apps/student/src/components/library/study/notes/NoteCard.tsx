'use client';

import type { StudyNote } from '@/lib/library';

interface Props {
  note:     StudyNote;
  onDelete: (noteId: string) => void;
}

export function NoteCard({ note, onDelete }: Props) {
  const ts = new Date(note.created_at).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short',
  });

  return (
    <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-3 group relative">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-xs text-gray-600">{ts}</span>
        {note.source_page && (
          <span className="text-xs text-gray-700">p.{note.source_page}</span>
        )}
        <button
          onClick={() => onDelete(note.note_id)}
          className="text-xs text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all ml-auto shrink-0"
          title="Delete note"
        >
          ✕
        </button>
      </div>

      {note.content && (
        <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
          {note.content}
        </p>
      )}

      {note.pinned_ai_response && (
        <div className={`mt-2 border-l-2 border-teal-700 pl-2 ${note.content ? '' : ''}`}>
          <p className="text-xs text-gray-600 mb-0.5">AI Answer</p>
          <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">
            {note.pinned_ai_response}
          </p>
        </div>
      )}
    </div>
  );
}
