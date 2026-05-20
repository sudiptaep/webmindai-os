import { useAuthStore } from '@/store/auth.store';

const API = process.env.NEXT_PUBLIC_API_URL!;

// ── Types ─────────────────────────────────────────────────────────────────

export interface DocCard {
  doc_id: string;
  filename: string;
  file_type: string;
  ingestion_status: 'pending' | 'processing' | 'completed' | 'failed';
  file_size_bytes: number;
  file_size_display: string;
  page_count: number | null;
  slide_count: number | null;
  duration_seconds: number | null;
  quality_score: number;
  ocr_used: boolean;
  download_enabled: boolean;
  thumbnail_url: string | null;
  academic_year: string;
  uploaded_at: string;
  has_chapter_map: boolean;
  chapter_count: number | null;
}

export interface Chapter {
  chapter_index: number;
  title: string;
  subtitle: string;
  start_page: number;
  end_page: number;
  page_count: number;
  chunk_count: number;
  pyq_count: number;
  pyq_years: string[];
  pyq_coverage_score: number;
}

export interface ChapterMapResponse {
  doc_id: string;
  doc_name: string;
  total_chapters: number;
  total_pages: number;
  extraction_method: string;
  confidence: number;
  chapters: Chapter[];
}

export interface SubjectGroup {
  subject_id: string | null;
  subject_name: string;
  subject_code: string | null;
  semester: number | null;
  year: number | null;
  doc_count: number;
  docs: DocCard[];
}

export interface LibraryResponse {
  subjects: SubjectGroup[];
  total_docs: number;
  student_year: number;
  pagination: { page: number; limit: number; total_pages: number };
}

export interface DocMeta {
  doc_id: string;
  dept_id: string;
  subject_id: string | null;
  college_id: string;
  original_filename: string;
  file_type: string;
  file_size_bytes: number;
  file_size_display: string;
  ingestion_status: string;
  chunk_count: number;
  ocr_used: boolean;
  quality_score: number;
  page_count: number | null;
  slide_count: number | null;
  duration_seconds: number | null;
  download_enabled: boolean;
  is_visible_to_students: boolean;
  academic_year: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AccessTokenResponse {
  token_url: string;
  expires_at: string;
  filename: string;
  file_size_bytes: number;
  file_type: string;
}

export interface TextPage {
  page_num: number;
  text: string;
  ocr_confidence: number | null;
}

export interface ExtractTextResponse {
  doc_id: string;
  filename: string;
  file_type: string;
  total_pages: number;
  ocr_used: boolean;
  quality_score: number;
  pages: TextPage[];
}

export interface ExtractJobResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  token_url?: string;
  expires_at?: string;
  error?: string;
}

export interface TranscriptSegment {
  start_sec: number;
  end_sec: number;
  text: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function absoluteUrl(relativeUrl: string): string {
  return `${API}${relativeUrl}`;
}

function authHeaders(token: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function apiFetch<T>(url: string, token: string, options?: RequestInit): Promise<T> {
  const doFetch = (t: string) =>
    fetch(url, { ...options, headers: { ...authHeaders(t), ...(options?.headers ?? {}) } });

  let res = await doFetch(token);

  if (res.status === 401) {
    try {
      const newToken = await useAuthStore.getState().refreshToken();
      res = await doFetch(newToken);
    } catch {
      useAuthStore.getState().clearAuth();
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── API functions ─────────────────────────────────────────────────────────

export type LibraryParams = {
  subject_id?: string; type?: string; semester?: string; study_year?: string; year?: string;
  q?: string; sort?: string; order?: string; page?: number; limit?: number;
};

export async function fetchLibrary(
  collegeId: string,
  token: string,
  params: LibraryParams = {},
): Promise<LibraryResponse> {
  const merged = { limit: 100, ...params };
  const qs = new URLSearchParams();
  Object.entries(merged).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
  const url = `${API}/api/v1/college/${collegeId}/student/library?${qs}`;
  const res = await apiFetch<LibraryResponse>(url, token);
  // Make thumbnail URLs absolute
  res.subjects.forEach(s =>
    s.docs.forEach(d => {
      if (d.thumbnail_url) d.thumbnail_url = absoluteUrl(d.thumbnail_url);
    }),
  );
  return res;
}

export async function fetchDocument(
  collegeId: string,
  docId: string,
  token: string,
): Promise<DocMeta> {
  return apiFetch(`${API}/api/v1/college/${collegeId}/student/library/${docId}`, token);
}

export async function getAccessToken(
  collegeId: string,
  docId: string,
  intent: 'download' | 'preview' | 'stream',
  token: string,
): Promise<AccessTokenResponse> {
  const res = await apiFetch<AccessTokenResponse>(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/access-token?intent=${intent}`,
    token,
  );
  return { ...res, token_url: absoluteUrl(res.token_url) };
}

export async function extractText(
  collegeId: string,
  docId: string,
  token: string,
  page?: number,
): Promise<ExtractTextResponse> {
  const qs = page !== undefined ? `?page=${page}` : '';
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/extract-text${qs}`,
    token,
  );
}

export function extractTextDownloadUrl(collegeId: string, docId: string): string {
  return `${API}/api/v1/college/${collegeId}/student/library/${docId}/extract-text/download`;
}

export async function submitExtractPages(
  collegeId: string,
  docId: string,
  body: { pages?: number[]; page_from?: number; page_to?: number },
  token: string,
): Promise<{ job_id: string; status: string; estimated_seconds: number }> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/extract-pages`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function pollExtractJob(
  collegeId: string,
  jobId: string,
  token: string,
): Promise<ExtractJobResponse> {
  const res = await apiFetch<ExtractJobResponse>(
    `${API}/api/v1/college/${collegeId}/student/library/extract-jobs/${jobId}`,
    token,
  );
  if (res.token_url) res.token_url = absoluteUrl(res.token_url);
  return res;
}

export async function fetchTranscript(
  collegeId: string,
  docId: string,
  token: string,
): Promise<{ doc_id: string; transcript: TranscriptSegment[] }> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/transcript`,
    token,
  );
}

// ── F-13-C: Chapter Chat ──────────────────────────────────────────────────

export type ChatMode = 'answer' | 'socratic';

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChapterChatSession {
  session_id: string;
  chapter_index: number;
  chapter_title: string;
  chat_mode: ChatMode;
  messages: SessionMessage[];
}

export async function createChapterChatSession(
  collegeId: string,
  docId: string,
  chapterIdx: number,
  token: string,
): Promise<ChapterChatSession> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/chat/session`,
    token,
    { method: 'POST', body: '{}' },
  );
}

export async function setChapterChatMode(
  collegeId: string,
  docId: string,
  chapterIdx: number,
  sessionId: string,
  mode: ChatMode,
  token: string,
): Promise<{ session_id: string; chat_mode: ChatMode }> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/chat/${sessionId}/mode`,
    token,
    { method: 'PATCH', body: JSON.stringify({ mode }) },
  );
}

export function chapterChatMessageUrl(
  collegeId: string,
  docId: string,
  chapterIdx: number,
  sessionId: string,
): string {
  return `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/chat/${sessionId}/message`;
}

export async function fetchChapters(
  collegeId: string,
  docId: string,
  token: string,
): Promise<ChapterMapResponse> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters`,
    token,
  );
}

// ── F-13-E: PYQ Intelligence ─────────────────────────────────────────────

export interface PYQQuestion {
  _id:             string;
  pyq_paper_id:    string;
  question_text:   string;
  question_type:   'MCQ' | 'SAQ' | 'LAQ' | 'CASE' | 'FIB';
  marks:           number;
  section:         string;
  year:            string;
  exam_name:       string;
  mapped_chapter_indices: number[];
}

export interface ChapterPyqResponse {
  questions:     PYQQuestion[];
  years_covered: string[];
  total_count:   number;
}

export async function fetchChapterPyq(
  collegeId: string,
  docId: string,
  chapterIdx: number,
  token: string,
): Promise<ChapterPyqResponse> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/pyq`,
    token,
  );
}

// ── F-13-D: Quiz Engine ───────────────────────────────────────────────────

export type QuizQuestionType = 'MCQ' | 'TF' | 'SAQ' | 'CASE' | 'MIXED';
export type QuizDifficulty   = 'recall' | 'application' | 'analysis' | 'adaptive';
export type QuizMode         = 'practice' | 'test' | 'timed';

export interface QuizQuestion {
  question_id:     string;
  question_text:   string;
  question_type:   QuizQuestionType;
  options:         string[];
  correct_answer:  string;
  explanation:     string;
  source_page?:    number;
  bloom_level:     string;
  difficulty:      QuizDifficulty;
  is_pyq:          boolean;
  pyq_year?:       string;
  student_answer?: string;
  is_correct?:     boolean;
}

export interface QuizGenerateResult {
  quiz_session_id:     string;
  questions:           QuizQuestion[];
  total_count:         number;
  time_limit_seconds:  number | null;
}

export interface QuizResults {
  score_pct:            number;
  correct_count:        number;
  total_count:          number;
  weak_topics:          string[];
  strong_topics:        string[];
  pyq_coverage_pct:     number;
  pyq_would_pass_count: number;
  recommendation:       string;
}

export interface QuizHistoryItem {
  _id:                string;
  doc_id:             string;
  chapter_index:      number;
  quiz_mode:          QuizMode;
  question_type:      QuizQuestionType;
  difficulty:         QuizDifficulty;
  status:             'in_progress' | 'completed' | 'abandoned';
  total_count:        number;
  score_pct:          number | null;
  started_at:         string;
  completed_at:       string | null;
  time_limit_seconds: number | null;
}

export interface GenerateQuizBody {
  question_type?:           QuizQuestionType;
  difficulty?:              QuizDifficulty;
  count?:                   number;
  include_pyq?:             boolean;
  timed?:                   boolean;
  time_limit_per_question?: number;
}

export async function generateQuiz(
  collegeId: string,
  docId: string,
  chapterIdx: number,
  body: GenerateQuizBody,
  token: string,
): Promise<QuizGenerateResult> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/quiz`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function submitAnswer(
  collegeId: string,
  sessionId: string,
  questionId: string,
  studentAnswer: string,
  token: string,
): Promise<{ is_correct: boolean; correct_answer: string; explanation: string }> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/quiz-sessions/${sessionId}/answer`,
    token,
    { method: 'POST', body: JSON.stringify({ question_id: questionId, student_answer: studentAnswer }) },
  );
}

export async function submitQuiz(
  collegeId: string,
  sessionId: string,
  answers: Array<{ question_id: string; student_answer: string }>,
  token: string,
): Promise<QuizResults> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/quiz-sessions/${sessionId}/submit`,
    token,
    { method: 'POST', body: JSON.stringify({ answers }) },
  );
}

export async function fetchQuizResults(
  collegeId: string,
  sessionId: string,
  token: string,
): Promise<QuizResults> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/quiz-sessions/${sessionId}/results`,
    token,
  );
}

export async function fetchQuizHistory(
  collegeId: string,
  token: string,
  params: { docId?: string; chapterIdx?: number; limit?: number } = {},
): Promise<{ sessions: QuizHistoryItem[] }> {
  const qs = new URLSearchParams();
  if (params.docId)      qs.set('docId', params.docId);
  if (params.chapterIdx !== undefined) qs.set('chapterIdx', String(params.chapterIdx));
  if (params.limit)      qs.set('limit', String(params.limit));
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/quiz-history?${qs}`,
    token,
  );
}

// ── F-13-H: Study Notes ───────────────────────────────────────────────────

export interface StudyNote {
  note_id:             string;
  content:             string;
  source_page?:        number;
  pinned_ai_response?: string;
  created_at:          string;
  updated_at:          string;
}

export async function fetchNotes(
  collegeId: string,
  docId: string,
  chapterIdx: number,
  token: string,
): Promise<{ notes: StudyNote[] }> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/notes`,
    token,
  );
}

export async function createNote(
  collegeId: string,
  docId: string,
  chapterIdx: number,
  body: { content?: string; source_page?: number; pinned_ai_response?: string },
  token: string,
): Promise<{ note: StudyNote }> {
  return apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/notes`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function deleteNote(
  collegeId: string,
  docId: string,
  chapterIdx: number,
  noteId: string,
  token: string,
): Promise<void> {
  await apiFetch(
    `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/notes/${noteId}`,
    token,
    { method: 'DELETE' },
  );
}

export function notesExportUrl(
  collegeId: string,
  docId: string,
  chapterIdx: number,
): string {
  return `${API}/api/v1/college/${collegeId}/student/library/${docId}/chapters/${chapterIdx}/notes/export`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
