'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { getAccessToken } from '@/lib/library';

interface Props {
  collegeId: string;
  docId: string;
  slideCount: number;
  thumbnailUrl: string | null; // doc-level thumbnail (first slide)
}

export function PptxViewer({ collegeId, docId, slideCount, thumbnailUrl }: Props) {
  const { token } = useAuthStore();
  const [selected, setSelected] = useState<number | null>(null);
  const [enlargedUrl, setEnlargedUrl] = useState<string | null>(thumbnailUrl);

  async function handleSlideClick(slideNum: number) {
    setSelected(slideNum);
    // For the first slide, we already have the thumbnail URL
    if (slideNum === 1 && thumbnailUrl) {
      setEnlargedUrl(thumbnailUrl);
      return;
    }
    // Other slides: we'd need individual thumbnail tokens — for now show same thumb
    if (token) {
      try {
        const res = await getAccessToken(collegeId, docId, 'preview', token);
        setEnlargedUrl(res.token_url);
      } catch { /* silent */ }
    }
  }

  const slideNumbers = Array.from({ length: Math.min(slideCount, 200) }, (_, i) => i + 1);

  return (
    <div className="flex h-full">
      {/* Slide grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-3">
          {slideNumbers.map(n => (
            <button
              key={n}
              onClick={() => handleSlideClick(n)}
              className={`aspect-video bg-gray-800 rounded-lg overflow-hidden border-2 transition-colors hover:border-teal-500 ${
                selected === n ? 'border-teal-500' : 'border-transparent'
              }`}
            >
              {n === 1 && thumbnailUrl ? (
                <img src={thumbnailUrl} alt={`Slide ${n}`} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                  Slide {n}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Enlarged view */}
      {selected !== null && (
        <div className="w-96 flex flex-col bg-gray-900 border-l border-gray-700 shrink-0">
          <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-400">
            Slide {selected} of {slideCount}
          </div>
          <div className="flex-1 flex items-center justify-center p-4 bg-gray-950">
            {enlargedUrl ? (
              <img src={enlargedUrl} alt={`Slide ${selected}`} className="max-w-full max-h-full object-contain rounded" />
            ) : (
              <div className="text-gray-500 text-sm">Preview not available</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
