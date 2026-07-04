'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { fetchImageGallery, type GalleryImage } from '@/lib/library';
import { ImageLightbox } from '@/components/ImageLightbox';

interface Props {
  docId: string;
  collegeId: string;
}

export function ImageGalleryTab({ docId, collegeId }: Props) {
  const token = useAuthStore((s) => s.token) ?? '';
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [byType, setByType] = useState<Record<string, number>>({});
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<GalleryImage | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchImageGallery(collegeId, docId, token, {
      image_type: typeFilter !== 'all' ? typeFilter : undefined,
      q: search || undefined,
      limit: 60,
    })
      .then((res) => {
        if (cancelled) return;
        setImages(res.images);
        setByType(res.by_type);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [collegeId, docId, token, typeFilter, search]);

  const types = Object.keys(byType);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-xs text-gray-200 rounded-lg px-2 py-1.5"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')} ({byType[t]})
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search labels/captions…"
          className="bg-gray-800 border border-gray-700 text-xs text-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[160px] placeholder-gray-500"
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && images.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-12">No images found for this document.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {images.map((img) => (
          <button
            key={img.image_asset_id}
            onClick={() => setExpanded(img)}
            className="text-left border border-gray-700/60 rounded-lg overflow-hidden bg-gray-800/60 hover:border-teal-600/50 transition-colors cursor-pointer"
          >
            <img src={img.thumbnail_url} alt={img.alt_text} className="w-full h-28 object-cover bg-white" />
            <div className="p-2">
              <p className="text-xs text-gray-200 line-clamp-2">{img.caption}</p>
              <p className="text-[10px] text-gray-500 mt-1">Pg.{img.source_page} · {img.image_type.replace(/_/g, ' ')}</p>
            </div>
          </button>
        ))}
      </div>

      {expanded && (
        <ImageLightbox
          src={expanded.token_url}
          alt={expanded.alt_text}
          caption={expanded.caption}
          labels={expanded.labels}
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  );
}
