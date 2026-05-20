'use client';

import { useAuthStore, selectCollegeType } from '@/store/auth.store';
import { type SubjectGroup } from '@/lib/library';
import { DocumentCard } from './DocumentCard';

interface Props {
  subjects: SubjectGroup[];
  collegeId: string;
  onPreview: (docId: string) => void;
  onAiSummary: (docId: string, pageCount?: number, fileType?: string) => void;
  onStudy: (docId: string) => void;
}

export function DocumentGrid({ subjects, collegeId, onPreview, onAiSummary, onStudy }: Props) {
  const isMedical = useAuthStore((s) => selectCollegeType(s) === 'medical');
  const semLabel = isMedical ? 'Year' : 'Sem';

  if (subjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-gray-500 py-16">
        <p className="text-4xl mb-3">📂</p>
        <p className="text-sm">No documents found</p>
        <p className="text-xs text-gray-600 mt-1">Documents must finish processing before they appear here</p>
      </div>
    );
  }

  // Group subjects by year-of-study; null year goes last as "General"
  const yearMap = new Map<number | null, SubjectGroup[]>();
  for (const sub of subjects) {
    const y = sub.year;
    if (!yearMap.has(y)) yearMap.set(y, []);
    yearMap.get(y)!.push(sub);
  }

  const sortedYears = Array.from(yearMap.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-10">
      {sortedYears.map(year => {
        const yearSubjects = yearMap.get(year)!;
        const yearLabel = year != null ? `Year ${year}` : 'General';

        return (
          <div key={year ?? 'general'}>
            {/* Year header — only shown when there are multiple year groups */}
            {sortedYears.length > 1 && (
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-base font-bold text-teal-400">{yearLabel}</h2>
                <div className="flex-1 h-px bg-gray-800" />
                <span className="text-xs text-gray-600">
                  {yearSubjects.reduce((n, s) => n + s.doc_count, 0)} docs
                </span>
              </div>
            )}

            <div className="space-y-8">
              {yearSubjects.map(subject => (
                <section key={subject.subject_id ?? 'general'}>
                  <div className="flex items-baseline gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-gray-200">{subject.subject_name}</h3>
                    {subject.subject_code && (
                      <span className="text-xs text-gray-500">{subject.subject_code}</span>
                    )}
                    {subject.semester && !isMedical && (
                      <span className="text-xs text-gray-500">· {semLabel} {subject.semester}</span>
                    )}
                    <span className="text-xs text-gray-600 ml-auto">
                      {subject.doc_count} doc{subject.doc_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {subject.docs.map(doc => (
                      <DocumentCard
                        key={doc.doc_id}
                        doc={doc}
                        collegeId={collegeId}
                        onPreview={onPreview}
                        onAiSummary={onAiSummary}
                        onStudy={onStudy}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
