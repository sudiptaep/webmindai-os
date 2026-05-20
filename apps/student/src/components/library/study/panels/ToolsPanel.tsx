'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { generateQuiz, type Chapter, type GenerateQuizBody, type QuizQuestion, type QuizResults as QuizResultsType } from '@/lib/library';
import { QuizConfigForm }    from '../quiz/QuizConfigForm';
import { QuizRunner }        from '../quiz/QuizRunner';
import { QuizResults }       from '../quiz/QuizResults';
import { PyqQuestionList }   from '../pyq/PyqQuestionList';
import { StudyNotes }        from '../notes/StudyNotes';

interface Props {
  chapter:   Chapter | null;
  docId:     string;
  collegeId: string;
}

type QuizPhase = 'config' | 'running' | 'results';

export function ToolsPanel({ chapter, docId, collegeId }: Props) {
  const token = useAuthStore(s => s.token) ?? '';

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

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-gray-950 overflow-y-auto">
      <div className="px-4 py-2.5 border-b border-gray-800 shrink-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tools</p>
      </div>

      {chapter ? (
        <div className="p-4 space-y-4">

          {/* ── Smart Quiz ────────────────────────────────────────── */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-300">Smart Quiz</p>
              {phase !== 'config' && (
                <button
                  onClick={handleNewConfig}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                >
                  ← Config
                </button>
              )}
            </div>

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
          </section>

          {/* ── PYQ Radar ─────────────────────────────────────────── */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-300">PYQ Radar</p>
              {chapter.pyq_count > 0 && (
                <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-800 px-2 py-0.5 rounded-full">
                  {chapter.pyq_count} PYQs
                </span>
              )}
            </div>

            {chapter.pyq_count > 0 ? (
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
            )}
          </section>

          {/* ── My Notes ─────────────────────────────────────────── */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-300 mb-3">My Notes</p>
            <StudyNotes
              collegeId={collegeId}
              docId={docId}
              chapterIndex={chapter.chapter_index}
            />
          </section>

        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6 text-gray-700 text-xs text-center">
          Select a chapter to see tools
        </div>
      )}
    </aside>
  );
}
