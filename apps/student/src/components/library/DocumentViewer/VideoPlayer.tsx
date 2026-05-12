'use client';

import { useRef, useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { fetchTranscript, type TranscriptSegment, formatDuration } from '@/lib/library';

interface Props {
  tokenUrl: string;
  collegeId: string;
  docId: string;
  filename: string;
}

export function VideoPlayer({ tokenUrl, collegeId, docId, filename }: Props) {
  const { token } = useAuthStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    fetchTranscript(collegeId, docId, token)
      .then(res => setTranscript(res.transcript))
      .catch(() => { /* transcript unavailable — show empty sidebar */ });
  }, [collegeId, docId, token]);

  const activeIdx = transcript.findLastIndex(s => s.start_sec <= currentTime);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIdx]);

  function seekTo(sec: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = sec;
    videoRef.current.play();
  }

  const filtered = transcriptSearch
    ? transcript.filter(s => s.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
    : transcript;

  return (
    <div className="flex h-full">
      {/* Video */}
      <div className="flex-1 flex flex-col bg-black">
        <video
          ref={videoRef}
          src={tokenUrl}
          controls
          className="flex-1 w-full object-contain"
          onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
        />
      </div>

      {/* Transcript sidebar */}
      <div className="w-72 flex flex-col bg-gray-900 border-l border-gray-700 shrink-0">
        <div className="px-3 py-2 border-b border-gray-700">
          <p className="text-xs font-semibold text-gray-300 mb-1.5">Transcript</p>
          <input
            value={transcriptSearch}
            onChange={e => setTranscriptSearch(e.target.value)}
            placeholder="Search transcript..."
            className="w-full text-xs bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-100 placeholder-gray-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {transcript.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">Transcript unavailable</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">No matches</p>
          ) : filtered.map((seg, i) => {
            const isActive = transcript.indexOf(seg) === activeIdx;
            return (
              <div
                key={i}
                ref={isActive ? activeRef : null}
                onClick={() => seekTo(seg.start_sec)}
                className={`cursor-pointer px-3 py-2 text-xs transition-colors hover:bg-gray-800 ${
                  isActive ? 'bg-teal-900/40 text-teal-300' : 'text-gray-400'
                }`}
              >
                <span className="font-mono text-gray-500 mr-2">{formatDuration(seg.start_sec)}</span>
                {seg.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
