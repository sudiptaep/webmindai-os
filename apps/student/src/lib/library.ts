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

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
