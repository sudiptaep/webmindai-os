'use client';

import { useAuthStore } from '@/store/auth.store';
import { useMyYear } from '@/hooks/useMyYear';
import { DashboardKPICards } from './DashboardKPICards';
import { YearSubjectGroup } from './YearSubjectGroup';
import { DiseaseSearchBar } from './DiseaseSearchBar';

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function MyYearView() {
  const { user } = useAuthStore();
  const { data, loading, error } = useMyYear();

  const isMedical = user?.college_type === 'medical';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  const yearLabel = data
    ? isMedical
      ? `MBBS Year ${data.student_year}`
      : `Year ${data.student_year}`
    : '';

  const semLabel = data
    ? isMedical
      ? `Semester ${data.student_semester}`
      : `Semester ${data.student_semester}`
    : '';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-gray-100">
          {getGreeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}.
        </h1>
        {data && (
          <p className="text-sm text-gray-500 mt-0.5">
            {yearLabel}
            {semLabel ? ` · ${semLabel}` : ''}
          </p>
        )}
      </div>

      {/* KPI cards */}
      {data && (
        <DashboardKPICards
          srsCardsdue={data.srs_cards_due_today}
          streak={data.study_streak}
          totalDocs={data.total_docs}
          totalSubjects={data.total_subjects}
        />
      )}

      {/* Subjects */}
      {data && data.subjects.length > 0 && (
        <div className="bg-[#151820] border border-gray-800/60 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/60">
            <h2 className="text-sm font-semibold text-gray-300">
              {isMedical
                ? `Year ${data.student_year} / Semester ${data.student_semester} Materials`
                : `${ordinal(data.student_year)} Year Materials`}
            </h2>
          </div>
          <div className="px-4 divide-y divide-gray-800/40">
            {data.subjects.map(subject => (
              <YearSubjectGroup key={subject.subject_id} subject={subject} />
            ))}
          </div>
        </div>
      )}

      {/* No subjects state */}
      {data && data.subjects.length === 0 && (
        <div className="bg-[#151820] border border-gray-800/60 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-500 mb-1">No materials found for your year and semester.</p>
          <p className="text-xs text-gray-600">Ask your faculty to upload content, or update your year in profile settings.</p>
        </div>
      )}

      {/* Disease search */}
      <DiseaseSearchBar />
    </div>
  );
}
