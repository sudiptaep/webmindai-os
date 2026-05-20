'use client';

import { useRef, useEffect } from 'react';
import { useDiseaseChat } from '@/hooks/useDisease';

interface DiseaseChatPanelProps {
  disease: string;
}

export function DiseaseChatPanel({ disease }: DiseaseChatPanelProps) {
  const { messages, input, setInput, streaming, sendMessage, stopStream } = useDiseaseChat(disease);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && input.trim()) sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.length === 0 && (
        <div className="bg-[#0f1117] border border-gray-800/40 rounded-xl p-4 text-center space-y-1">
          <p className="text-sm text-gray-400">Ask anything about <span className="text-teal-400 capitalize">{disease}</span></p>
          <p className="text-xs text-gray-600">Answers draw from all your uploaded subjects</p>
        </div>
      )}

      {messages.length > 0 && (
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-teal-700/30 border border-teal-700/40 text-gray-100'
                    : 'bg-[#1e2330] border border-gray-700/40 text-gray-200'
                }`}
              >
                {msg.content || (
                  <span className="inline-block w-1.5 h-4 bg-teal-400 animate-pulse align-middle rounded-sm" />
                )}
                {msg.role === 'assistant' && streaming && msg.content && (
                  <span className="inline-block w-1.5 h-4 bg-teal-400 animate-pulse ml-0.5 align-middle rounded-sm" />
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask about ${disease}…`}
          rows={2}
          className="flex-1 resize-none bg-[#0f1117] border border-gray-700/60 rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-teal-600/60 transition-colors"
        />
        {streaming ? (
          <button
            onClick={stopStream}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
