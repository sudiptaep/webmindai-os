'use client';

const API = process.env.NEXT_PUBLIC_API_URL!;

export type CaseQuestionType = 'diagnosis' | 'management' | 'investigation' | 'mechanism' | 'complication';
export type CaseDifficulty   = 'recall' | 'application' | 'analysis';

export interface CaseForStudent {
  case_id:             string;
  case_text:           string;
  question:            string;
  question_type:       CaseQuestionType;
  difficulty:          CaseDifficulty;
  options:             string[];
  correct_answer:      string;
  expected_answer:     string;
  key_teaching_points: string[];
  source_pages:        number[];
  doc_id:              string;
  chapter_index:       number;
  from_cache:          boolean;
}

export interface CaseListing {
  _id:           string;
  case_text:     string;
  question:      string;
  question_type: CaseQuestionType;
  difficulty:    CaseDifficulty;
  times_served:  number;
  created_at:    string;
}

export async function generateClinicalCase(
  token: string,
  collegeId: string,
  docId: string,
  chapterIdx: number,
  questionType: CaseQuestionType,
  difficulty: CaseDifficulty,
): Promise<CaseForStudent> {
  const res = await fetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/cases/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question_type: questionType, difficulty }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? 'Case generation failed');
  }
  return res.json();
}

export async function listCases(
  token: string,
  collegeId: string,
  docId: string,
  chapterIdx: number,
): Promise<{ cases: CaseListing[]; total: number }> {
  const res = await fetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/cases`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Failed to load cases');
  return res.json();
}

export async function addCaseToSRS(
  token: string,
  collegeId: string,
  caseId: string,
): Promise<{ srs_card_id: string; next_review_at: string }> {
  const res = await fetch(
    `${API}/api/v1/college/${collegeId}/student/cases/${caseId}/add-to-srs`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error('Failed to add to SRS');
  return res.json();
}
