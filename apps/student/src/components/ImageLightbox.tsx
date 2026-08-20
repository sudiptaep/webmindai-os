'use client';

import { useEffect } from 'react';

interface ImageLightboxProps {
  src: string;
  alt: string;
  caption: string;
  labels: string[];
  onClose: () => void;
}

export function ImageLightbox({ src, alt, caption, labels, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="max-w-5xl max-h-full flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt} className="max-h-[80vh] object-contain rounded-lg bg-white" />

        <div className="bg-card/90 border border-border/60 rounded-lg p-3 text-center">
          <p className="text-foreground text-sm font-medium">{caption}</p>
          {labels.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1 mt-2">
              {labels.map((l) => (
                <span key={l} className="text-xs bg-accent/50 text-foreground px-2 py-0.5 rounded">
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm text-center cursor-pointer"
        >
          ✕ Close (Esc)
        </button>
      </div>
    </div>
  );
}
