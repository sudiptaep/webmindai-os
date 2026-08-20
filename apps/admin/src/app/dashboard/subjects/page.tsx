'use client';

import { useState, useRef, useEffect, ChangeEvent, FormEvent } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

const API = process.env.NEXT_PUBLIC_API_URL!;

const CURRENT_YEAR = new Date().getFullYear();
const ACADEMIC_YEAR_OPTIONS = [
  `${CURRENT_YEAR - 1}-${CURRENT_YEAR}`,
  `${CURRENT_YEAR}-${CURRENT_YEAR + 1}`,
  `${CURRENT_YEAR + 1}-${CURRENT_YEAR + 2}`,
];

type IngestionStatus = 'pending' | 'processing' | 'completed' | 'failed';
const STATUS_COLORS: Record<IngestionStatus, string> = {
  pending:    'text-yellow-700 dark:text-yellow-400',
  processing: 'text-primary',
  completed:  'text-green-700 dark:text-green-400',
  failed:     'text-destructive',
};

type DocRow = {
  _id: string;
  original_filename: string;
  ingestion_status: IngestionStatus;
  file_type: string;
  chunk_count?: number;
};

type SubjectRow = {
  _id: string;
  name: string;
  code: string;
  semester: number;
  year: number;
};

type DeptRow = { _id: string; name: string };

// ── SubjectCard — server-side doc list, own upload + delete ──────────────────

type SubjectCardProps = {
  sub: SubjectRow;
  collegeId: string;
  deptId: string;
  acadYear: string;
  isMedical: boolean;
};

function SubjectCard({ sub, collegeId, deptId, acadYear, isMedical }: SubjectCardProps) {
  const { token } = useAuthStore();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [imagesEnabled, setImagesEnabled] = useState(true);

  const { data, isLoading } = trpc.document.list.useQuery(
    { college_id: collegeId, dept_id: deptId, subject_id: sub._id, page: 1, limit: 500 },
    { enabled: !!collegeId && !!deptId && !!token, refetchInterval: 5000 },
  );

  const deleteMut = trpc.subject.delete.useMutation({
    onSuccess: () => utils.subject.list.invalidate(),
  });

  const docs = (data?.docs ?? []) as DocRow[];

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploadError('');
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('dept_id', deptId);
    form.append('academic_year', acadYear);
    form.append('subject_id', sub._id);
    form.append('images_enabled', String(imagesEnabled));
    try {
      const res = await fetch(`${API}/api/v1/college/${collegeId}/admin/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? 'Upload failed');
      }
      await utils.document.list.invalidate();
      setCollapsed(false);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="bg-muted border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-4">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
        >
          <span className="text-sm font-medium truncate">{sub.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {sub.code} ·{' '}
            {isMedical ? `Year ${sub.year}` : `Sem ${sub.semester} · Year ${sub.year}`}
          </span>
          <span className="text-xs bg-accent text-foreground px-1.5 py-0.5 rounded-full shrink-0">
            {isLoading ? '…' : `${docs.length} file${docs.length !== 1 ? 's' : ''}`}
          </span>
          <span className="text-muted-foreground text-xs shrink-0">{collapsed ? '▼' : '▲'}</span>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer" title="Extract & analyse embedded diagrams (GPT-4o Vision, ~$0.25-0.60/book)">
            <input
              type="checkbox"
              checked={imagesEnabled}
              onChange={(e) => setImagesEnabled(e.target.checked)}
              className="cursor-pointer"
            />
            Images
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.pptx,.docx,.mp4,.mp3,.m4a"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-white px-3 py-1 rounded transition-colors"
          >
            {uploading ? 'Uploading…' : '+ Upload'}
          </button>
          <button
            onClick={() => deleteMut.mutate({ subject_id: sub._id, dept_id: deptId })}
            disabled={deleteMut.isPending}
            className="text-xs text-destructive hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 px-2 py-1 border border-red-300 dark:border-red-800 rounded"
          >
            Delete
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="px-4 pb-2 text-xs text-destructive">{uploadError}</div>
      )}

      {!collapsed && (
        <div className="border-t border-border">
          {isLoading ? (
            <p className="text-xs text-muted-foreground px-4 py-3">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-3">
              No files yet. Click + Upload to add one.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {docs.map((doc) => (
                <div key={doc._id} className="px-4 py-2 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground uppercase shrink-0 w-10">{doc.file_type}</span>
                  <span className="text-xs text-foreground flex-1 truncate">{doc.original_filename}</span>
                  <span className={`text-xs shrink-0 ${STATUS_COLORS[doc.ingestion_status] ?? 'text-muted-foreground'}`}>
                    {doc.ingestion_status}
                  </span>
                  {doc.chunk_count != null && (
                    <span className="text-xs text-muted-foreground shrink-0">{doc.chunk_count} chunks</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DeptSubjectList — fetches subjects for one dept, renders SubjectCards ─────

type DeptSubjectListProps = {
  dept: DeptRow;
  collegeId: string;
  acadYear: string;
  isMedical: boolean;
  showHeader: boolean;
};

function DeptSubjectList({ dept, collegeId, acadYear, isMedical, showHeader }: DeptSubjectListProps) {
  const { token } = useAuthStore();
  const deptId = String(dept._id);

  const { data: subjectsData, isLoading } = trpc.subject.list.useQuery(
    { college_id: collegeId, dept_id: deptId },
    { enabled: !!collegeId && !!deptId && !!token },
  );

  const subjects: SubjectRow[] = subjectsData ?? [];

  return (
    <div>
      {showHeader && (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-4 first:mt-0">
          {dept.name}
        </p>
      )}
      <div className="space-y-2">
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && subjects.length === 0 && (
          <p className="text-xs text-muted-foreground">No subjects in this department.</p>
        )}
        {subjects.map((sub) => (
          <SubjectCard
            key={sub._id}
            sub={sub}
            collegeId={collegeId}
            deptId={deptId}
            acadYear={acadYear}
            isMedical={isMedical}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function SubjectsPage() {
  const { token, user } = useAuthStore();
  const collegeId = user?.college_id ?? '';

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [semester, setSemester] = useState('1');
  const [year, setYear] = useState('1');
  const [selectedDeptId, setSelectedDeptId] = useState(''); // '' = All
  const [formDeptId, setFormDeptId] = useState('');
  const [uploadingAcadYear, setUploadingAcadYear] = useState(ACADEMIC_YEAR_OPTIONS[0]);
  const utils = trpc.useUtils();

  const { data: college } = trpc.college.getOwn.useQuery(undefined, {
    enabled: !!collegeId && !!token,
  });

  const { data: depts } = trpc.department.listOwn.useQuery(undefined, {
    enabled: !!collegeId && !!token,
  });

  // Auto-select the single dept on load
  useEffect(() => {
    if (depts?.[0] && !selectedDeptId) {
      const id = String(depts[0]._id);
      setSelectedDeptId(id);
      setFormDeptId(id);
    }
  }, [depts, selectedDeptId]);

  const isMedical = !!college && college.type === 'medical';
  const allMode = selectedDeptId === '';
  const activeDeptId = selectedDeptId;

  const createMut = trpc.subject.create.useMutation({
    onSuccess: () => {
      utils.subject.list.invalidate();
      setName(''); setCode(''); setSemester('1'); setYear('1'); setFormDeptId('');
      setShowForm(false);
    },
  });

  const effectiveFormDeptId = formDeptId || (allMode ? '' : activeDeptId);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!effectiveFormDeptId) return;
    createMut.mutate({
      dept_id: effectiveFormDeptId,
      name,
      code,
      semester: isMedical ? Number(year) : Number(semester),
      year: Number(year),
    });
  }

  const deptList: DeptRow[] = (depts ?? []).map((d) => ({ _id: String(d._id), name: d.name }));

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold">Subjects</h1>
          {college && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {college.name} · {isMedical ? 'Medical (by Year)' : 'Engineering (by Semester)'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {deptList.length > 1 ? (
            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="bg-muted border border-border rounded px-2 py-1.5 text-sm"
            >
              <option value="">All Departments</option>
              {deptList.map((d) => (
                <option key={d._id} value={d._id}>{d.name}</option>
              ))}
            </select>
          ) : deptList[0] ? (
            <span className="text-sm text-muted-foreground px-2 py-1.5 bg-muted rounded border border-border">
              {deptList[0].name}
            </span>
          ) : null}
          <select
            value={uploadingAcadYear}
            onChange={(e) => setUploadingAcadYear(e.target.value)}
            className="bg-muted border border-border rounded px-2 py-1.5 text-sm"
            title="Academic year for uploads"
          >
            {ACADEMIC_YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded text-sm transition-colors"
          >
            {showForm ? 'Cancel' : 'Add Subject'}
          </button>
        </div>
      </div>

      {/* Add Subject form */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="bg-muted border border-border rounded-lg p-4 mb-6 grid grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <label className="block text-xs text-muted-foreground mb-1">Department</label>
            <select
              value={effectiveFormDeptId}
              onChange={(e) => setFormDeptId(e.target.value)}
              className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
              required
            >
              <option value="">Select department</option>
              {deptList.map((d) => (
                <option key={d._id} value={d._id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
              required
            />
          </div>

          {isMedical ? (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Year</label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
              >
                {[1, 2, 3, 4, 5, 6].map((y) => (
                  <option key={y} value={y}>Year {y}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Semester</label>
                <select
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>Sem {s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Year of Study</label>
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                >
                  {[1, 2, 3, 4, 5, 6].map((y) => (
                    <option key={y} value={y}>Year {y}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="col-span-2">
            <button
              type="submit"
              disabled={createMut.isPending || !effectiveFormDeptId}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 px-4 py-1.5 rounded text-sm"
            >
              {createMut.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {/* Subject lists */}
      {allMode ? (
        // All departments mode — one group per dept
        <div className="space-y-1">
          {deptList.length === 0 && (
            <p className="text-muted-foreground text-sm">No departments found.</p>
          )}
          {deptList.map((dept) => (
            <DeptSubjectList
              key={dept._id}
              dept={dept}
              collegeId={collegeId}
              acadYear={uploadingAcadYear}
              isMedical={isMedical}
              showHeader={deptList.length > 1}
            />
          ))}
        </div>
      ) : (
        // Specific department mode
        <div className="space-y-2">
          {activeDeptId && (
            <DeptSubjectList
              key={activeDeptId}
              dept={{ _id: activeDeptId, name: '' }}
              collegeId={collegeId}
              acadYear={uploadingAcadYear}
              isMedical={isMedical}
              showHeader={false}
            />
          )}
        </div>
      )}
    </div>
  );
}
