'use client';

import { useState } from 'react';
import type { ChatImage } from '@/store/chat.store';
import { ImageLightbox } from './ImageLightbox';

const API = process.env.NEXT_PUBLIC_API_URL!;

const TYPE_COLORS: Record<string, string> = {
  anatomical_diagram: 'bg-blue-500/15 text-blue-300',
  histology: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  pathology: 'bg-rose-500/15 text-rose-300',
  flowchart: 'bg-green-500/15 text-green-700 dark:text-green-300',
  graph_chart: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  circuit_diagram: 'bg-orange-500/15 text-orange-300',
  block_diagram: 'bg-orange-500/15 text-orange-300',
  chemical_structure: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300',
  clinical_image: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300',
};

export function InlineChatImage({ image }: { image: ChatImage }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const typeBadgeClass = TYPE_COLORS[image.image_type] ?? 'bg-accent/50 text-foreground';
  const fullUrl = `${API}${image.token_url}`;

  return (
    <div className="mt-2 border border-border/60 rounded-xl overflow-hidden bg-muted/60 max-w-sm">
      <div className="relative cursor-pointer group" onClick={() => setIsExpanded(true)}>
        {!loaded && !errored && (
          <div className="h-40 bg-accent/50 animate-pulse flex items-center justify-center">
            <span className="text-muted-foreground text-xs">Loading image…</span>
          </div>
        )}
        {errored && (
          <div className="h-40 bg-accent/50 flex items-center justify-center">
            <span className="text-muted-foreground text-xs">Image unavailable</span>
          </div>
        )}
        <img
          src={fullUrl}
          alt={image.alt_text}
          className={`w-full max-h-60 object-contain bg-white ${loaded ? 'block' : 'hidden'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-xs px-3 py-1 rounded-full transition-opacity">
            Click to expand
          </span>
        </div>
      </div>

      <div className="p-2.5">
        <p className="text-xs font-medium text-foreground mb-1.5">{image.caption}</p>

        {image.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {image.labels.slice(0, 6).map((label) => (
              <span key={label} className="text-[10px] bg-accent/50 text-muted-foreground px-1.5 py-0.5 rounded">
                {label}
              </span>
            ))}
            {image.labels.length > 6 && (
              <span className="text-[10px] text-muted-foreground">+{image.labels.length - 6} more</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground truncate">
            {image.doc_filename} · Page {image.source_page}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ml-1 ${typeBadgeClass}`}>
            {image.image_type.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {isExpanded && (
        <ImageLightbox
          src={fullUrl}
          alt={image.alt_text}
          caption={image.caption}
          labels={image.labels}
          onClose={() => setIsExpanded(false)}
        />
      )}
    </div>
  );
}
