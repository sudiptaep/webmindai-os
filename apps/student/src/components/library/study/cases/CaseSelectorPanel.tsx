'use client';

import { useState, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import {
  generateClinicalCase,
  type CaseForStudent,
  type CaseQuestionType,
  type CaseDifficulty,
} from '@/hooks/useClinicalCase';
import { CaseConfig }      from './CaseConfig';
import { CaseDisplay }     from './CaseDisplay';
import { CaseHistoryList } from './CaseHistoryList';

type Phase = 'config' | 'result' | 'history';

interface CaseSelectorPanelProps {
  collegeId:  string;
  docId:      string;
  chapterIdx: number;
}

export function CaseSelectorPanel({ collegeId, docId, chapterIdx }: CaseSelectorPanelProps) {
  const { token } = useAuthStore();

  const [phase,        setPhase]        = useState<Phase>('config');
  const [questionType, setQuestionType] = useState<CaseQuestionType>('diagnosis');
  const [difficulty,   setDifficulty]   = useState<CaseDifficulty>('application');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [result,       setResult]       = useState<CaseForStudent | null>(null);
  const [historyCount, setHistoryCount] = useState(0);

  const handleGenerate = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const c = await generateClinicalCase(token, collegeId, docId, chapterIdx, questionType, difficulty);
      setResult(c);
      setHistoryCount(n => n + 1);
      setPhase('result');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, collegeId, docId, chapterIdx, questionType, difficulty]);

  function handleGenerateNew() {
    setResult(null);
    setError(null);
    setPhase('config');
  }

  function handleHistorySelect({ questionType: qt, difficulty: d }: { questionType: CaseQuestionType; difficulty: CaseDifficulty }) {
    setQuestionType(qt);
    setDifficulty(d);
    setPhase('config');
  }

  return (
    <div>
      {phase === 'config' && (
        <>
          <CaseConfig
            questionType={questionType}
            difficulty={difficulty}
            loading={loading}
            onTypeChange={setQuestionType}
            onDifficultyChange={setDifficulty}
            onGenerate={handleGenerate}
            onShowHistory={() => setPhase('history')}
            historyCount={historyCount}
          />
          {error && (
            <p className="mt-2 text-[10px] text-red-400 leading-snug">{error}</p>
          )}
        </>
      )}

      {phase === 'result' && result && (
        <CaseDisplay
          clinicalCase={result}
          collegeId={collegeId}
          onGenerateNew={handleGenerateNew}
        />
      )}

      {phase === 'history' && (
        <CaseHistoryList
          collegeId={collegeId}
          docId={docId}
          chapterIdx={chapterIdx}
          onSelect={handleHistorySelect}
          onClose={() => setPhase('config')}
        />
      )}
    </div>
  );
}
