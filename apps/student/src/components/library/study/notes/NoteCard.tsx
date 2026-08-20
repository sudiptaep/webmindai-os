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
    <div className="bg-muted/60 border border-border/60 rounded-lg p-3 group relative">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-xs text-muted-foreground">{ts}</span>
        {note.source_page && (
          <span className="text-xs text-muted-foreground">p.{note.source_page}</span>
        )}
        <button
          onClick={() => onDelete(note.note_id)}
          className="text-xs text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all ml-auto shrink-0"
          title="Delete note"
        >
          ✕
        </button>
      </div>

      {note.content && (
        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
          {note.content}
        </p>
      )}

      {note.pinned_ai_response && (
        <div className={`mt-2 border-l-2 border-teal-700 pl-2 ${note.content ? '' : ''}`}>
          <p className="text-xs text-muted-foreground mb-0.5">AI Answer</p>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {note.pinned_ai_response}
          </p>
        </div>
      )}
    </div>
  );
}
