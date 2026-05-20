'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import {
  fetchNotes, createNote, deleteNote, notesExportUrl,
  type StudyNote,
} from '@/lib/library';
import { NoteCard } from './NoteCard';

interface Props {
  collegeId:    string;
  docId:        string;
  chapterIndex: number;
}

export function StudyNotes({ collegeId, docId, chapterIndex }: Props) {
  const token = useAuthStore(s => s.token) ?? '';

  const [notes,   setNotes]   = useState<StudyNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [text,    setText]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchNotes(collegeId, docId, chapterIndex, token)
      .then(d => { if (!cancelled) setNotes(d.notes); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [collegeId, docId, chapterIndex, token]);

  async function handleAdd() {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const res = await createNote(collegeId, docId, chapterIndex, { content: text.trim() }, token);
      setNotes(prev => [...prev, res.note]);
      setText('');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(noteId: string) {
    await deleteNote(collegeId, docId, chapterIndex, noteId, token);
    setNotes(prev => prev.filter(n => n.note_id !== noteId));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  }

  const exportUrl = `${notesExportUrl(collegeId, docId, chapterIndex)}?token=${token}`;

  return (
    <div className="space-y-3">
      {/* Notes list */}
      {loading ? (
        <div className="flex justify-center py-3">
          <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-gray-600">No notes yet. Add your first note below.</p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {notes.map(n => (
            <NoteCard key={n.note_id} note={n} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Add note input */}
      <div className="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Add a note… (Enter to save)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 p-2.5 resize-none focus:outline-none focus:border-teal-600 placeholder:text-gray-600"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleAdd}
            disabled={!text.trim() || saving}
            className="flex-1 text-xs py-1.5 rounded-lg bg-teal-700 hover:bg-teal-600 disabled:opacity-40 text-white transition-colors"
          >
            {saving ? '…' : 'Save Note'}
          </button>
          {notes.length > 0 && (
            <a
              href={exportUrl}
              download
              className="text-xs px-2 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
              title="Download notes as text file"
            >
              ↓ Export
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
