'use client';

import { useAuthStore, selectCollegeType } from '@/store/auth.store';
import { type SubjectGroup, type LibraryParams } from '@/lib/library';

interface Props {
  subjects: SubjectGroup[];
  params: LibraryParams;
  studentYear: number;
  onChange: (p: Partial<LibraryParams>) => void;
}

const FILE_TYPES = ['all', 'pdf', 'pptx', 'mp4', 'mp3', 'docx'] as const;

export function SubjectSidebar({ subjects, params, studentYear, onChange }: Props) {
  const isMedical = useAuthStore((s) => selectCollegeType(s) === 'medical');
  const semLabel = isMedical ? 'Year' : 'Sem';

  // Active year: explicit param or student's default year
  const activeYear = params.study_year ? Number(params.study_year) : studentYear;

  // All unique years from subjects, plus student's own year (even if no docs yet)
  const years = Array.from(
    new Set([
      studentYear,
      ...subjects.map((s) => s.year).filter((y): y is number => y !== null),
    ]),
  ).sort((a, b) => a - b);

  return (
    <aside className="w-60 shrink-0 bg-gray-900 border-r border-gray-700 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-700">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Search</p>
        <input
          value={params.q ?? ''}
          onChange={e => onChange({ q: e.target.value || undefined })}
          placeholder="Search documents..."
          className="w-full text-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 placeholder-gray-500"
        />
      </div>

      <div className="px-4 py-3 border-b border-gray-700">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Year</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onChange({ study_year: undefined, subject_id: undefined })}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              !params.study_year
                ? 'bg-teal-600 border-teal-500 text-white'
                : 'border-gray-600 text-gray-400 hover:text-white'
            }`}
          >
            My Year {studentYear}
          </button>
          {years.filter(y => y !== studentYear).map(y => (
            <button
              key={y}
              onClick={() => onChange({ study_year: String(y), subject_id: undefined })}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                params.study_year === String(y)
                  ? 'bg-teal-600 border-teal-500 text-white'
                  : 'border-gray-600 text-gray-400 hover:text-white'
              }`}
            >
              Year {y}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-gray-700">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">File Type</p>
        <div className="flex flex-wrap gap-1.5">
          {FILE_TYPES.map(t => (
            <button
              key={t}
              onClick={() => onChange({ type: t === 'all' ? undefined : t })}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                (params.type ?? 'all') === t
                  ? 'bg-teal-600 border-teal-500 text-white'
                  : 'border-gray-600 text-gray-400 hover:text-white'
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-gray-700">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sort</p>
        <select
          value={`${params.sort ?? 'date'}-${params.order ?? 'desc'}`}
          onChange={e => {
            const [sort, order] = e.target.value.split('-');
            onChange({ sort, order });
          }}
          className="w-full text-xs bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-100"
        >
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
          <option value="size-desc">Largest first</option>
          <option value="size-asc">Smallest first</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Subjects</p>
        <nav className="space-y-0.5">
          <button
            onClick={() => onChange({ subject_id: undefined })}
            className={`w-full text-left text-xs px-2.5 py-2 rounded-lg transition-colors ${
              !params.subject_id ? 'bg-teal-900/40 text-teal-300' : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            All subjects
            <span className="ml-1 text-gray-500">({subjects.reduce((n, s) => n + s.doc_count, 0)})</span>
          </button>
          {subjects.map(s => (
            <button
              key={s.subject_id ?? 'general'}
              onClick={() => onChange({ subject_id: s.subject_id ?? undefined })}
              className={`w-full text-left text-xs px-2.5 py-2 rounded-lg transition-colors ${
                params.subject_id === s.subject_id ? 'bg-teal-900/40 text-teal-300' : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span className="block truncate">{s.subject_name}</span>
              {s.subject_code && (
                <span className="text-gray-500">{s.subject_code} · </span>
              )}
              {s.year != null && <span className="text-gray-500">Year {s.year} · </span>}
              {s.semester && !isMedical && <span className="text-gray-500">{semLabel} {s.semester} · </span>}
              <span className="text-gray-500">{s.doc_count} docs</span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
}
