'use client';

import Link from 'next/link';
import type { SourceCitation as Source } from '@/store/chat.store';

export function SourceCitation({ source }: { source: Source }) {
  const label = [
    source.subject,
    source.page != null ? `Pg ${source.page}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const href = source.doc_id
    ? `/library/${source.doc_id}${source.page != null ? `?page=${source.page}` : ''}`
    : null;

  const content = (
    <>
      <span className="text-blue-300">—</span>
      <span>{source.filename || 'Document'}</span>
      {label && <span className="text-muted-foreground">[{label}]</span>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1 bg-accent hover:bg-accent text-xs px-2 py-0.5 rounded-full cursor-pointer underline-offset-2 hover:underline"
        title={source.doc_id}
      >
        {content}
      </Link>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 bg-accent text-xs px-2 py-0.5 rounded-full cursor-default"
      title={source.doc_id}
    >
      {content}
    </span>
  );
}
