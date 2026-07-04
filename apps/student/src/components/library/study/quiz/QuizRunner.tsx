'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { submitAnswer, submitQuiz, type QuizQuestion, type QuizResults } from '@/lib/library';

interface Props {
  collegeId:         string;
  sessionId:         string;
  questions:         QuizQuestion[];
  timeLimitSeconds:  number | null;
  isPractice:        boolean;
  onComplete:        (results: QuizResults) => void;
}

export function QuizRunner({ collegeId, sessionId, questions, timeLimitSeconds, isPractice, onComplete }: Props) {
  const token = useAuthStore(s => s.token) ?? '';

  const [idx,        setIdx]        = useState(0);
  const [selected,   setSelected]   = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState('');
  const [feedback,   setFeedback]   = useState<{ is_correct: boolean; correct_answer: string; explanation: string } | null>(null);
  const [answered,   setAnswered]   = useState<Map<string, string>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft,   setTimeLeft]   = useState(timeLimitSeconds);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Global countdown timer
  useEffect(() => {
    if (timeLimitSeconds == null) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t == null || t <= 1) {
          clearInterval(timerRef.current!);
          handleFinish();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const q = questions[idx];
  const isLast = idx === questions.length - 1;
  const isTextBased = q.question_type === 'SAQ' || q.question_type === 'CASE';
  const isImageLabel = q.question_type === 'IMAGE_LABEL';

  async function handleAnswer() {
    const ans = isTextBased ? textAnswer.trim() : (selected ?? '');
    if (!ans) return;

    setSubmitting(true);
    try {
      if (isPractice) {
        const fb = await submitAnswer(collegeId, sessionId, q.question_id, ans, token);
        setFeedback(fb);
      }
      setAnswered(prev => new Map(prev).set(q.question_id, ans));
    } finally {
      setSubmitting(false);
    }
  }

  function handleNext() {
    setSelected(null);
    setTextAnswer('');
    setFeedback(null);
    if (isLast) {
      handleFinish();
    } else {
      setIdx(i => i + 1);
    }
  }

  async function handleFinish() {
    if (timerRef.current) clearInterval(timerRef.current);
    setSubmitting(true);
    try {
      const remaining = questions
        .filter(q => !answered.has(q.question_id))
        .map(q => ({ question_id: q.question_id, student_answer: '' }));
      const allAnswers = [
        ...Array.from(answered.entries()).map(([question_id, student_answer]) => ({ question_id, student_answer })),
        ...remaining,
      ];
      const results = await submitQuiz(collegeId, sessionId, allAnswers, token);
      onComplete(results);
    } finally {
      setSubmitting(false);
    }
  }

  const hasAnsweredCurrent = answered.has(q.question_id);
  const progressPct = ((idx + (hasAnsweredCurrent ? 1 : 0)) / questions.length) * 100;

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Progress + timer row */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-500 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-xs text-gray-500 shrink-0">{idx + 1}/{questions.length}</span>
        {timeLeft != null && (
          <span className={`text-xs font-mono shrink-0 ${timeLeft < 60 ? 'text-red-400' : 'text-gray-400'}`}>
            {formatTime(timeLeft)}
          </span>
        )}
      </div>

      {/* Question card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs bg-violet-900/50 text-violet-400 border border-violet-800 px-2 py-0.5 rounded-full">
            {q.question_type}
          </span>
          {q.is_pyq && (
            <span className="text-xs bg-amber-900/40 text-amber-400 border border-amber-800 px-2 py-0.5 rounded-full">
              PYQ {q.pyq_year ?? ''}
            </span>
          )}
          <span className="text-xs text-gray-600 ml-auto">{q.bloom_level}</span>
        </div>

        <p className="text-sm text-gray-200 leading-relaxed mb-4">{q.question_text}</p>

        {/* Image label diagram */}
        {isImageLabel && q.image_token_url && (
          <img
            src={q.image_token_url}
            alt="Diagram"
            className="w-full max-h-64 object-contain bg-white rounded-lg mb-3"
          />
        )}

        {/* Image label options (plain label text, not lettered) */}
        {isImageLabel && (
          <div className="space-y-2">
            {q.options.map((opt, i) => {
              const isSelected = selected === opt;
              const showCorrect = feedback != null;
              const isCorrectOpt = opt.trim().toUpperCase() === feedback?.correct_answer.trim().toUpperCase();
              const isWrong = showCorrect && isSelected && !feedback!.is_correct;

              return (
                <button
                  key={i}
                  disabled={!!feedback || hasAnsweredCurrent}
                  onClick={() => setSelected(opt)}
                  className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                    showCorrect && isCorrectOpt
                      ? 'bg-teal-900/40 border-teal-700 text-teal-300'
                      : isWrong
                        ? 'bg-red-900/40 border-red-700 text-red-300'
                        : isSelected
                          ? 'bg-violet-900/50 border-violet-600 text-violet-200'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {/* MCQ / TF options */}
        {(q.question_type === 'MCQ' || q.question_type === 'TF') && (
          <div className="space-y-2">
            {q.options.map((opt, i) => {
              const key = opt.charAt(0).toUpperCase();
              const isSelected = selected === key;
              const showCorrect = feedback != null;
              const isCorrectOpt = key === feedback?.correct_answer.trim().toUpperCase();
              const isWrong = showCorrect && isSelected && !feedback!.is_correct;

              return (
                <button
                  key={i}
                  disabled={!!feedback || hasAnsweredCurrent}
                  onClick={() => setSelected(key)}
                  className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                    showCorrect && isCorrectOpt
                      ? 'bg-teal-900/40 border-teal-700 text-teal-300'
                      : isWrong
                        ? 'bg-red-900/40 border-red-700 text-red-300'
                        : isSelected
                          ? 'bg-violet-900/50 border-violet-600 text-violet-200'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {/* SAQ / CASE text input */}
        {isTextBased && (
          <textarea
            value={textAnswer}
            onChange={e => setTextAnswer(e.target.value)}
            disabled={!!feedback || hasAnsweredCurrent}
            rows={3}
            placeholder="Write your answer…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 p-2.5 resize-none focus:outline-none focus:border-violet-600 placeholder:text-gray-600"
          />
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`mt-3 p-3 rounded-lg text-xs border ${
            feedback.is_correct
              ? 'bg-teal-900/30 border-teal-800 text-teal-300'
              : 'bg-red-900/30 border-red-800 text-red-300'
          }`}>
            <p className="font-semibold mb-1">{feedback.is_correct ? 'Correct!' : `Incorrect — Answer: ${feedback.correct_answer}`}</p>
            {feedback.explanation && <p className="text-gray-400">{feedback.explanation}</p>}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        {!hasAnsweredCurrent && !feedback && (
          <button
            onClick={handleAnswer}
            disabled={submitting || (!selected && !textAnswer.trim())}
            className="flex-1 text-xs py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white font-medium transition-colors"
          >
            {submitting ? '…' : 'Submit Answer'}
          </button>
        )}
        {(feedback || hasAnsweredCurrent) && (
          <button
            onClick={handleNext}
            disabled={submitting}
            className="flex-1 text-xs py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-200 font-medium transition-colors"
          >
            {isLast ? (submitting ? 'Finishing…' : 'Finish Quiz') : 'Next →'}
          </button>
        )}
        {!isPractice && !isLast && (
          <button
            onClick={() => { setAnswered(prev => new Map(prev).set(q.question_id, selected ?? textAnswer ?? '')); handleNext(); }}
            className="text-xs px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-500 transition-colors"
            title="Skip question"
          >
            Skip
          </button>
        )}
      </div>

      {/* Jump to finish */}
      {!isPractice && (
        <button
          onClick={handleFinish}
          disabled={submitting}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors text-center"
        >
          Submit all &amp; finish
        </button>
      )}
    </div>
  );
}
