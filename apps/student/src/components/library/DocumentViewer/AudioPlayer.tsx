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

export function AudioPlayer({ tokenUrl, collegeId, docId, filename }: Props) {
  const { token } = useAuthStore();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [search, setSearch] = useState('');
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    fetchTranscript(collegeId, docId, token)
      .then(res => setTranscript(res.transcript))
      .catch(() => {});
  }, [collegeId, docId, token]);

  const activeIdx = transcript.findLastIndex(s => s.start_sec <= currentTime);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIdx]);

  function seekTo(sec: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = sec;
    audioRef.current.play();
  }

  const filtered = search
    ? transcript.filter(s => s.text.toLowerCase().includes(search.toLowerCase()))
    : transcript;

  return (
    <div className="flex flex-col h-full">
      {/* Audio controls */}
      <div className="bg-gray-800 px-6 py-5 border-b border-gray-700">
        <p className="text-sm font-medium text-gray-200 mb-3 truncate">{filename}</p>
        <audio
          ref={audioRef}
          src={tokenUrl}
          controls
          className="w-full"
          onTimeUpdate={e => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        />
      </div>

      {/* Transcript */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-300">Transcript</p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="ml-auto text-xs bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-gray-100 placeholder-gray-500 w-44"
          />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-800">
          {transcript.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">Transcript unavailable</p>
          ) : filtered.map((seg, i) => {
            const isActive = transcript.indexOf(seg) === activeIdx;
            return (
              <div
                key={i}
                ref={isActive ? activeRef : null}
                onClick={() => seekTo(seg.start_sec)}
                className={`cursor-pointer px-4 py-2.5 text-sm transition-colors hover:bg-gray-800 ${
                  isActive ? 'bg-teal-900/40 text-teal-300' : 'text-gray-300'
                }`}
              >
                <span className="font-mono text-xs text-gray-500 mr-2">{formatDuration(seg.start_sec)}</span>
                {seg.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
