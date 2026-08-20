'use client';

import { useState, useCallback, KeyboardEvent } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set once — avoids re-initialising the worker on every render
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

interface Props {
  tokenUrl: string;
  initialPage?: number;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronsLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  );
}

function ChevronsRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  );
}

const BTN =
  'flex items-center justify-center w-8 h-8 rounded-md border border-border bg-card text-foreground ' +
  'hover:bg-accent hover:text-white disabled:opacity-30 disabled:hover:bg-card disabled:hover:text-foreground ' +
  'disabled:cursor-not-allowed transition-colors';

export function PdfViewer({ tokenUrl, initialPage = 1 }: Props) {
  const [numPages, setNumPages]     = useState(0);
  const [page, setPage]             = useState(initialPage);
  const [pageInput, setPageInput]   = useState(String(initialPage));
  const [containerWidth, setContainerWidth] = useState(0);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setContainerWidth(node.clientWidth);
  }, []);

  function goTo(n: number) {
    const clamped = Math.max(1, Math.min(numPages || 1, n));
    setPage(clamped);
    setPageInput(String(clamped));
  }

  function commitInput() {
    const n = parseInt(pageInput, 10);
    if (!isNaN(n)) goTo(n);
    else setPageInput(String(page));
  }

  function handleInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitInput();
    if (e.key === 'Escape') setPageInput(String(page));
  }

  function onDocLoadSuccess({ numPages: n }: { numPages: number }) {
    setNumPages(n);
    if (page > n) goTo(n);
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-center gap-2 px-4 py-2 bg-card border-b border-border shrink-0 text-sm text-muted-foreground">
        {/* First / prev */}
        <button onClick={() => goTo(1)} disabled={page <= 1} className={BTN} title="First page">
          <ChevronsLeftIcon />
        </button>
        <button onClick={() => goTo(page - 1)} disabled={page <= 1} className={BTN} title="Previous page">
          <ChevronLeftIcon />
        </button>

        {/* Page input */}
        <div className="flex items-center gap-2 mx-1">
          <span>Page</span>
          <input
            type="number"
            value={pageInput}
            min={1}
            max={numPages || undefined}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={handleInputKey}
            onBlur={commitInput}
            className="w-14 h-8 bg-muted border border-border rounded-md px-2 text-white text-center focus:outline-none focus:border-teal-500"
          />
          <span>of {numPages || '…'}</span>
        </div>

        {/* Next / last */}
        <button onClick={() => goTo(page + 1)} disabled={page >= numPages} className={BTN} title="Next page">
          <ChevronRightIcon />
        </button>
        <button onClick={() => goTo(numPages)} disabled={page >= numPages} className={BTN} title="Last page">
          <ChevronsRightIcon />
        </button>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 overflow-y-auto flex justify-center bg-background py-4">
        {/*
          key={tokenUrl} — forces full Document remount when URL changes.
          This properly destroys the old PDF.js worker before creating a new one,
          preventing the "null.sendWithPromise" race condition.
        */}
        <Document
          key={tokenUrl}
          file={tokenUrl}
          onLoadSuccess={onDocLoadSuccess}
          loading={<Spinner />}
          error={
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Could not load PDF.
            </div>
          }
        >
          {/*
            key={page} — remounts Page on each navigation, discarding any
            in-flight render from the previous page that might hold a stale
            worker reference.
            renderTextLayer/AnnotationLayer off — massive perf gain for
            large PDFs; re-enable if text selection is needed.
          */}
          <Page
            key={page}
            pageNumber={page}
            width={containerWidth ? containerWidth - 32 : undefined}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={<Spinner />}
            onRenderError={(err) => {
              // Swallow sendWithPromise null errors from stale worker refs
              console.warn('[PdfViewer] page render error:', err);
            }}
          />
        </Document>
      </div>
    </div>
  );
}
