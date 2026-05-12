'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { getAccessToken } from '@/lib/library';

interface Props {
  collegeId: string;
  docId: string;
  filename: string;
  fileSizeBytes: number;
}

const LARGE_FILE_THRESHOLD = 500_000_000; // 500 MB

export function DownloadButton({ collegeId, docId, filename, fileSizeBytes }: Props) {
  const { token } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    if (!token) return;
    if (fileSizeBytes > LARGE_FILE_THRESHOLD) {
      const mb = (fileSizeBytes / 1024 / 1024).toFixed(0);
      if (!confirm(`This file is ${mb} MB. Download may take several minutes on slow connections.\n\nContinue?`)) return;
    }
    setLoading(true);
    setError(null);
    try {
      const { token_url } = await getAccessToken(collegeId, docId, 'download', token);
      const a = document.createElement('a');
      a.href = token_url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        {loading ? (
          <span className="inline-block w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <span>↓</span>
        )}
        Download
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
