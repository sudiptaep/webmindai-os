'use client';

import { useState, useRef, useEffect, ChangeEvent } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { trpc } from '@/lib/trpc';

const API = process.env.NEXT_PUBLIC_API_URL!;

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => String(CURRENT_YEAR - i));

type IngestionStatus = 'pending' | 'processing' | 'completed' | 'failed';

const STATUS_COLORS: Record<IngestionStatus, string> = {
  pending:    'text-yellow-400',
  processing: 'text-blue-400',
  completed:  'text-green-400',
  failed:     'text-red-400',
};

type SubjectItem = { _id: string; name: string; code: string };
type PYQPaper = {
  _id:               string;
  year:              string;
  month?:            string;
  exam_name:         string;
  university?:       string;
  dept_id:           string;
  subject_id?:       string;
  ingestion_status:  IngestionStatus;
  question_count?:   number;
  createdAt?:        string;
};

export default function PYQPage() {
  const { token, user } = useAuthStore();
  const collegeId = user?.college_id ?? '';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading,  setUploading]  = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');

  // Form state
  const [selectedDeptId,    setSelectedDeptId]    = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [year,        setYear]        = useState(String(CURRENT_YEAR));
  const [month,       setMonth]       = useState('');
  const [examName,    setExamName]    = useState('');
  const [university,  setUniversity]  = useState('');

  // Filter state
  const [filterDeptId, setFilterDeptId] = useState('');

  const { data: depts } = trpc.department.listOwn.useQuery(undefined, {
    enabled: !!collegeId && !!token,
  });

  const { data: subjects } = trpc.subject.list.useQuery(
    { college_id: collegeId, dept_id: selectedDeptId },
    { enabled: !!collegeId && !!selectedDeptId && !!token },
  );

  // Reset subject when dept changes
  useEffect(() => { setSelectedSubjectId(''); }, [selectedDeptId]);

  const [papers, setPapers] = useState<PYQPaper[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(false);

  async function loadPapers() {
    if (!collegeId || !token) return;
    setLoadingPapers(true);
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (filterDeptId) qs.set('dept_id', filterDeptId);
      const res = await fetch(
        `${API}/api/v1/college/${collegeId}/admin/pyq?${qs}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json() as { papers: PYQPaper[] };
        setPapers(data.papers ?? []);
      }
    } finally {
      setLoadingPapers(false);
    }
  }

  useEffect(() => { loadPapers(); }, [collegeId, token, filterDeptId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    if (!selectedDeptId) { setUploadError('Select a department first'); return; }
    if (!examName.trim()) { setUploadError('Enter exam name'); return; }

    setUploadError('');
    setUploadSuccess('');
    setUploading(true);

    const form = new FormData();
    form.append('file', file);
    form.append('dept_id', selectedDeptId);
    form.append('year', year);
    form.append('exam_name', examName.trim());
    if (month)       form.append('month', month);
    if (university)  form.append('university', university.trim());
    if (selectedSubjectId) form.append('subject_id', selectedSubjectId);

    try {
      const res = await fetch(`${API}/api/v1/college/${collegeId}/admin/pyq/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Upload failed');
      }
      setUploadSuccess(`Uploaded successfully — ingestion queued`);
      setExamName('');
      setMonth('');
      setUniversity('');
      await loadPapers();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemap(paperId: string) {
    if (!token) return;
    await fetch(`${API}/api/v1/college/${collegeId}/admin/pyq/${paperId}/remap`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    await loadPapers();
  }

  const subjectMap = new Map<string, SubjectItem>(
    (subjects ?? []).map((s: SubjectItem) => [s._id, s]),
  );

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">PYQ Papers</h1>

      {/* Upload form */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Upload Question Paper (PDF)</h2>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Department *</label>
            <select
              value={selectedDeptId}
              onChange={e => setSelectedDeptId(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            >
              <option value="">Select department</option>
              {(depts ?? []).map(d => (
                <option key={String(d._id)} value={String(d._id)}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Subject</label>
            <select
              value={selectedSubjectId}
              onChange={e => setSelectedSubjectId(e.target.value)}
              disabled={!selectedDeptId}
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="">No specific subject</option>
              {(subjects ?? []).map((s: SubjectItem) => (
                <option key={s._id} value={s._id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Exam Name *</label>
            <input
              type="text"
              value={examName}
              onChange={e => setExamName(e.target.value)}
              placeholder="e.g. VTU June 2024"
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Year *</label>
            <select
              value={year}
              onChange={e => setYear(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            >
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Month</label>
            <input
              type="text"
              value={month}
              onChange={e => setMonth(e.target.value)}
              placeholder="e.g. June"
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">University</label>
            <input
              type="text"
              value={university}
              onChange={e => setUniversity(e.target.value)}
              placeholder="e.g. VTU"
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {uploadError   && <p className="text-xs text-red-400 mb-3">{uploadError}</p>}
        {uploadSuccess && <p className="text-xs text-green-400 mb-3">{uploadSuccess}</p>}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleUpload}
          className="hidden"
          id="pyq-upload"
        />
        <label
          htmlFor="pyq-upload"
          className={`inline-block cursor-pointer bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium transition-colors ${
            uploading || !selectedDeptId || !examName.trim() ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          {uploading ? 'Uploading…' : 'Select PDF & Upload'}
        </label>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={filterDeptId}
          onChange={e => setFilterDeptId(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
        >
          <option value="">All Departments</option>
          {(depts ?? []).map(d => (
            <option key={String(d._id)} value={String(d._id)}>{d.name}</option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{papers.length} papers</span>
      </div>

      {/* Papers list */}
      {loadingPapers && <p className="text-sm text-gray-400">Loading…</p>}

      {!loadingPapers && papers.length === 0 && (
        <p className="text-sm text-gray-500">No PYQ papers yet. Upload your first question paper above.</p>
      )}

      <div className="space-y-2">
        {papers.map(paper => (
          <div key={paper._id} className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {paper.exam_name}
                  {paper.university && <span className="text-gray-400"> · {paper.university}</span>}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {paper.year}{paper.month && ` · ${paper.month}`}
                  {' · '}
                  <span className={STATUS_COLORS[paper.ingestion_status] ?? 'text-gray-400'}>
                    {paper.ingestion_status}
                  </span>
                  {paper.question_count != null && ` · ${paper.question_count} questions`}
                  {paper.subject_id && subjectMap.get(paper.subject_id) && (
                    <span className="text-blue-400"> · {subjectMap.get(paper.subject_id)!.name}</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleRemap(paper._id)}
                  className="text-xs text-gray-400 hover:text-gray-100 px-2 py-1 border border-gray-600 rounded"
                >
                  Re-map chapters
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
