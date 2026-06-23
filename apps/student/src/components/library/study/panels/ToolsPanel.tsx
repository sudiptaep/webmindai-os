'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { generateQuiz, type Chapter, type GenerateQuizBody, type QuizQuestion, type QuizResults as QuizResultsType } from '@/lib/library';
import { QuizConfigForm }    from '../quiz/QuizConfigForm';
import { QuizRunner }        from '../quiz/QuizRunner';
import { QuizResults }       from '../quiz/QuizResults';
import { PyqQuestionList }      from '../pyq/PyqQuestionList';
import { StudyNotes }           from '../notes/StudyNotes';
import { CaseSelectorPanel }    from '../cases/CaseSelectorPanel';

interface Props {
  chapter:   Chapter | null;
  docId:     string;
  collegeId: string;
}

type QuizPhase = 'config' | 'running' | 'results';
type SectionKey = 'quiz' | 'pyq' | 'notes' | 'cases';

// ── Inline SVG icons ─────────────────────────────────────────────────────────

function ChevronDown({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M10 2h4v4M6 14H2v-4M14 10v4h-4M2 6V2h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

// ── Section header component ──────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  badge?: React.ReactNode;
  accentColor?: string;
}

function SectionHeader({ title, expanded, onToggle, onOpen, badge, accentColor = 'text-gray-300' }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 flex-1 min-w-0 group"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-200 shrink-0 ${expanded ? '' : '-rotate-90'}`}
        />
        <p className={`text-xs font-semibold truncate ${accentColor}`}>{title}</p>
        {badge && <span className="ml-1 shrink-0">{badge}</span>}
      </button>
      <button
        onClick={onOpen}
        title={`Open ${title} in full view`}
        className="shrink-0 p-1 rounded-md text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
      >
        <MaximizeIcon />
      </button>
    </div>
  );
}

// ── Full-screen overlay for a single tool ────────────────────────────────────

interface ToolOverlayProps {
  title: string;
  accentColor: string;
  onClose: () => void;
  children: React.ReactNode;
}

function ToolOverlay({ title, accentColor, onClose, children }: ToolOverlayProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gray-950">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 shrink-0">
        <p className={`text-sm font-semibold ${accentColor}`}>{title}</p>
        <button
          onClick={onClose}
          className="ml-auto p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          title="Close (Esc)"
        >
          <CloseIcon />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Main ToolsPanel ───────────────────────────────────────────────────────────

export function ToolsPanel({ chapter, docId, collegeId }: Props) {
  const token = useAuthStore(s => s.token) ?? '';

  // Expand/collapse per section
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    quiz:  true,
    pyq:   true,
    notes: false,
    cases: false,
  });

  // Which section is open full-screen (null = none)
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);

  // Quiz state
  const [phase,       setPhase]       = useState<QuizPhase>('config');
  const [generating,  setGenerating]  = useState(false);
  const [genError,    setGenError]    = useState<string | null>(null);
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [questions,   setQuestions]   = useState<QuizQuestion[]>([]);
  const [timeLimit,   setTimeLimit]   = useState<number | null>(null);
  const [isPractice,  setIsPractice]  = useState(true);
  const [results,     setResults]     = useState<QuizResultsType | null>(null);

  // PYQ list
  const [showPyq, setShowPyq] = useState(false);

  function toggleSection(key: SectionKey) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleGenerate(body: GenerateQuizBody) {
    if (!chapter) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await generateQuiz(collegeId, docId, chapter.chapter_index, body, token);
      setSessionId(res.quiz_session_id);
      setQuestions(res.questions);
      setTimeLimit(res.time_limit_seconds);
      setIsPractice(!body.timed);
      setPhase('running');
    } catch (e) {
      setGenError((e as Error).message ?? 'Failed to generate quiz');
    } finally {
      setGenerating(false);
    }
  }

  function handleComplete(r: QuizResultsType) {
    setResults(r);
    setPhase('results');
  }

  function handleRetry() {
    setPhase('running');
    setResults(null);
  }

  function handleNewConfig() {
    setPhase('config');
    setSessionId(null);
    setQuestions([]);
    setResults(null);
    setGenError(null);
  }

  // ── Section content renderers ──────────────────────────────────────────────

  function renderQuizContent(inOverlay = false) {
    if (!chapter) return null;
    return (
      <div className={inOverlay ? 'space-y-4' : ''}>
        {phase !== 'config' && (
          <div className="flex justify-end mb-2">
            <button
              onClick={handleNewConfig}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              ← Config
            </button>
          </div>
        )}
        {phase === 'config' && (
          <>
            <QuizConfigForm
              chapterTitle={chapter.title}
              hasPyq={chapter.pyq_count > 0}
              onGenerate={handleGenerate}
              loading={generating}
            />
            {genError && <p className="mt-2 text-xs text-red-400">{genError}</p>}
          </>
        )}
        {phase === 'running' && sessionId && (
          <QuizRunner
            collegeId={collegeId}
            sessionId={sessionId}
            questions={questions}
            timeLimitSeconds={timeLimit}
            isPractice={isPractice}
            onComplete={handleComplete}
          />
        )}
        {phase === 'results' && results && (
          <QuizResults
            results={results}
            totalCount={questions.length}
            onRetry={handleRetry}
            onNewQuiz={handleNewConfig}
          />
        )}
      </div>
    );
  }

  function renderPyqContent() {
    if (!chapter) return null;
    return chapter.pyq_count > 0 ? (
      <>
        <div className="space-y-1.5 mb-3">
          {chapter.pyq_years.map(year => (
            <div key={year} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-10">{year}</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full"
                  style={{ width: `${Math.min(chapter.pyq_coverage_score * 100, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setShowPyq(v => !v)}
          className="text-xs text-amber-500 hover:text-amber-400 transition-colors"
        >
          {showPyq ? '▲ Hide questions' : '▼ See questions'}
        </button>
        {showPyq && (
          <PyqQuestionList
            collegeId={collegeId}
            docId={docId}
            chapterIndex={chapter.chapter_index}
            chapterTitle={chapter.title}
            onClose={() => setShowPyq(false)}
          />
        )}
      </>
    ) : (
      <p className="text-xs text-gray-600">No PYQs mapped yet</p>
    );
  }

  function renderNotesContent() {
    if (!chapter) return null;
    return (
      <StudyNotes
        collegeId={collegeId}
        docId={docId}
        chapterIndex={chapter.chapter_index}
      />
    );
  }

  function renderCasesContent() {
    if (!chapter) return null;
    return (
      <CaseSelectorPanel
        collegeId={collegeId}
        docId={docId}
        chapterIdx={chapter.chapter_index}
      />
    );
  }

  // ── Overlay renderer ───────────────────────────────────────────────────────

  function renderOverlay() {
    if (!openSection || !chapter) return null;

    const configs: Record<SectionKey, { title: string; accent: string; content: () => React.ReactNode }> = {
      quiz:  { title: 'Smart Quiz',     accent: 'text-violet-300', content: () => renderQuizContent(true) },
      pyq:   { title: 'PYQ Radar',      accent: 'text-amber-300',  content: renderPyqContent },
      notes: { title: 'My Notes',       accent: 'text-teal-300',   content: renderNotesContent },
      cases: { title: 'Clinical Cases', accent: 'text-rose-300',   content: renderCasesContent },
    };

    const cfg = configs[openSection];
    return (
      <ToolOverlay title={cfg.title} accentColor={cfg.accent} onClose={() => setOpenSection(null)}>
        {cfg.content()}
      </ToolOverlay>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <aside className="w-72 shrink-0 flex flex-col bg-gray-950 overflow-y-auto">
        <div className="px-4 py-2.5 border-b border-gray-800 shrink-0">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tools</p>
        </div>

        {chapter ? (
          <div className="p-3 space-y-2">

            {/* ── Smart Quiz ──────────────────────────────────────── */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2.5">
                <SectionHeader
                  title="Smart Quiz"
                  accentColor="text-violet-300"
                  expanded={expanded.quiz}
                  onToggle={() => toggleSection('quiz')}
                  onOpen={() => setOpenSection('quiz')}
                />
              </div>
              {expanded.quiz && (
                <div className="px-3 pb-3 border-t border-gray-800/60 pt-2.5">
                  {renderQuizContent()}
                </div>
              )}
            </section>

            {/* ── PYQ Radar ───────────────────────────────────────── */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2.5">
                <SectionHeader
                  title="PYQ Radar"
                  accentColor="text-amber-300"
                  expanded={expanded.pyq}
                  onToggle={() => toggleSection('pyq')}
                  onOpen={() => setOpenSection('pyq')}
                  badge={
                    chapter.pyq_count > 0 ? (
                      <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded-full">
                        {chapter.pyq_count}
                      </span>
                    ) : undefined
                  }
                />
              </div>
              {expanded.pyq && (
                <div className="px-3 pb-3 border-t border-gray-800/60 pt-2.5">
                  {renderPyqContent()}
                </div>
              )}
            </section>

            {/* ── My Notes ────────────────────────────────────────── */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2.5">
                <SectionHeader
                  title="My Notes"
                  accentColor="text-teal-300"
                  expanded={expanded.notes}
                  onToggle={() => toggleSection('notes')}
                  onOpen={() => setOpenSection('notes')}
                />
              </div>
              {expanded.notes && (
                <div className="px-3 pb-3 border-t border-gray-800/60 pt-2.5">
                  {renderNotesContent()}
                </div>
              )}
            </section>

            {/* ── Clinical Cases ───────────────────────────────────── */}
            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2.5">
                <SectionHeader
                  title="Clinical Cases"
                  accentColor="text-rose-300"
                  expanded={expanded.cases}
                  onToggle={() => toggleSection('cases')}
                  onOpen={() => setOpenSection('cases')}
                />
              </div>
              {expanded.cases && (
                <div className="px-3 pb-3 border-t border-gray-800/60 pt-2.5">
                  {renderCasesContent()}
                </div>
              )}
            </section>

          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6 text-gray-700 text-xs text-center">
            Select a chapter to see tools
          </div>
        )}
      </aside>

      {/* Full-screen tool overlay */}
      {renderOverlay()}
    </>
  );
}
