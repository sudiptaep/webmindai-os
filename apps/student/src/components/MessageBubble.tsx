import type { Message } from '@/store/chat.store';
import { SourceCitation } from './SourceCitation';
import { InlineChatImage } from './InlineChatImage';

const NEGATIVE_PATTERNS = [
  /\bi don'?t have (information|details|data)/i,
  /\bnot mentioned\b/i,
  /\bnot (found|available|present|included) in\b/i,
  /\bnot in the (uploaded|provided|course|given)\b/i,
  /\bno (information|mention|reference|details) (about|on|for|regarding)\b/i,
  /\bcannot find\b/i,
  /\bno relevant (content|material|information)\b/i,
];

function isNegativeAnswer(content: string): boolean {
  return NEGATIVE_PATTERNS.some((p) => p.test(content));
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const hasError = !isUser && !!message.errorType;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'bg-blue-600 text-white rounded-br-sm'
              : hasError
                ? 'bg-red-950/40 text-red-200 border border-red-900/50 rounded-bl-sm'
                : 'bg-gray-800 text-gray-100 rounded-bl-sm'
          }`}
        >
          {hasError ? message.errorMessage : message.content}
          {message.streaming && (
            <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse" />
          )}
        </div>
        {!isUser && message.answered && !isNegativeAnswer(message.content) && message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 px-1">
            {message.sources.map((src) => (
              <SourceCitation key={src.doc_id + (src.chunk_index ?? '')} source={src} />
            ))}
          </div>
        )}
        {!isUser && message.answered && message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
            {message.images.map((img) => (
              <InlineChatImage key={img.image_asset_id} image={img} />
            ))}
          </div>
        )}
        {!isUser && message.answered === false && !message.streaming && (
          <p className="text-xs text-amber-400 mt-1 px-1">
            No relevant content found — your question has been flagged for review.
          </p>
        )}
      </div>
    </div>
  );
}
