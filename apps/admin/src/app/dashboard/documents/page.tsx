'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

type IngestionStatus = 'pending' | 'processing' | 'completed' | 'failed';

const STATUS_COLORS: Record<IngestionStatus, string> = {
  pending: 'text-yellow-400',
  processing: 'text-blue-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
};

type SubjectItem = { _id: string; name: string; code: string };
type DocItem = {
  _id: string;
  original_filename: string;
  ingestion_status: IngestionStatus;
  file_type: string;
  createdAt?: string;
  chunk_count?: number;
  subject_id?: string | null;
  download_enabled?: boolean;
  is_visible_to_students?: boolean;
};

export default function DocumentsPage() {
  const { token, user } = useAuthStore();
  const collegeId = user?.college_id ?? '';
  const [selectedDeptId, setSelectedDeptId] = useState('');

  // Inline subject-edit state
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingSubjectVal, setEditingSubjectVal] = useState('');

  const { data: depts } = trpc.department.listOwn.useQuery(undefined, {
    enabled: !!collegeId && !!token,
  });

  // Auto-select the single dept for dept_admin on first load
  useEffect(() => {
    if (depts?.[0] && !selectedDeptId) {
      setSelectedDeptId(String(depts[0]._id));
    }
  }, [depts, selectedDeptId]);

  const activeDeptId = selectedDeptId || (user?.dept_id ?? '');

  const { data: subjects } = trpc.subject.list.useQuery(
    { college_id: collegeId, dept_id: activeDeptId },
    { enabled: !!collegeId && !!activeDeptId && !!token }
  );

  const { data, isLoading, refetch } = trpc.document.list.useQuery(
    { college_id: collegeId, dept_id: activeDeptId || undefined, page: 1, limit: 50 },
    { enabled: !!collegeId && !!token, refetchInterval: 5000 }
  );

  const deleteMut = trpc.document.delete.useMutation({ onSuccess: () => refetch() });
  const reingestMut = trpc.document.reingest.useMutation({ onSuccess: () => refetch() });
  const libSettingsMut = trpc.document.updateLibrarySettings.useMutation({ onSuccess: () => refetch() });
  const assignSubjectMut = trpc.document.assignSubject.useMutation({
    onSuccess: () => {
      refetch();
      setEditingDocId(null);
    },
  });

  function startEditSubject(doc: DocItem) {
    setEditingDocId(doc._id);
    setEditingSubjectVal(doc.subject_id ?? '');
  }

  function cancelEditSubject() {
    setEditingDocId(null);
    setEditingSubjectVal('');
  }

  function saveSubject(docId: string) {
    assignSubjectMut.mutate({
      college_id: collegeId,
      doc_id: docId,
      subject_id: editingSubjectVal || null,
    });
  }

  const subjectMap = new Map<string, SubjectItem>(
    (subjects ?? []).map((s: SubjectItem) => [s._id, s])
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold">Documents</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {(depts ?? []).length > 1 ? (
            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
            >
              <option value="">All Departments</option>
              {(depts ?? []).map((d) => (
                <option key={String(d._id)} value={String(d._id)}>{d.name}</option>
              ))}
            </select>
          ) : depts?.[0] ? (
            <span className="text-sm text-gray-400 px-2 py-1.5 bg-gray-800 rounded border border-gray-600">
              {depts[0].name}
            </span>
          ) : null}
        </div>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Loading…</p>}

      {!isLoading && data?.docs?.length === 0 && (
        <p className="text-gray-500 text-sm">No documents yet. Upload your first document.</p>
      )}

      <div className="space-y-2">
        {data?.docs?.map((doc: DocItem) => {
          const currentSubject = doc.subject_id ? subjectMap.get(doc.subject_id) : null;
          const isEditing = editingDocId === doc._id;

          return (
            <div
              key={doc._id}
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/dashboard/documents/${doc._id}`}
                    className="text-sm font-medium truncate hover:text-blue-400 transition-colors block"
                  >
                    {doc.original_filename}
                  </Link>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {doc.file_type?.toUpperCase()} ·{' '}
                    <span className={STATUS_COLORS[doc.ingestion_status] ?? 'text-gray-400'}>
                      {doc.ingestion_status}
                    </span>
                    {doc.chunk_count != null && ` · ${doc.chunk_count} chunks`}
                    {currentSubject && (
                      <span className="text-blue-400"> · {currentSubject.name}</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                  {/* Library visibility toggles */}
                  <button
                    onClick={() => libSettingsMut.mutate({ college_id: collegeId, doc_id: doc._id, is_visible_to_students: !(doc.is_visible_to_students !== false) })}
                    title="Toggle student visibility"
                    className={`text-xs px-2 py-1 border rounded ${doc.is_visible_to_students !== false ? 'text-green-400 border-green-800' : 'text-gray-500 border-gray-700 line-through'}`}
                  >
                    Visible
                  </button>
                  <button
                    onClick={() => libSettingsMut.mutate({ college_id: collegeId, doc_id: doc._id, download_enabled: !(doc.download_enabled !== false) })}
                    title="Toggle download"
                    className={`text-xs px-2 py-1 border rounded ${doc.download_enabled !== false ? 'text-blue-400 border-blue-800' : 'text-gray-500 border-gray-700 line-through'}`}
                  >
                    DL
                  </button>
                  <button
                    onClick={() => isEditing ? cancelEditSubject() : startEditSubject(doc)}
                    className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1 border border-gray-600 rounded"
                  >
                    {isEditing ? 'Cancel' : 'Subject'}
                  </button>
                  <button
                    onClick={() => reingestMut.mutate({ college_id: collegeId, doc_id: doc._id })}
                    className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1 border border-gray-600 rounded"
                  >
                    Re-ingest
                  </button>
                  <button
                    onClick={() => deleteMut.mutate({ college_id: collegeId, doc_id: doc._id })}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 border border-red-800 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 flex items-center gap-2 border-t border-gray-700 pt-3">
                  <select
                    value={editingSubjectVal}
                    onChange={(e) => setEditingSubjectVal(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">No Subject</option>
                    {(subjects ?? []).map((s: SubjectItem) => (
                      <option key={s._id} value={s._id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                  <button
                    onClick={() => saveSubject(doc._id)}
                    disabled={assignSubjectMut.isPending}
                    className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-1.5 rounded"
                  >
                    {assignSubjectMut.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
