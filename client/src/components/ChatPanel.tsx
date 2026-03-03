import { useEffect, useRef, useState, KeyboardEvent } from 'react';
import type { Message } from '../types';
import { MessageBubble } from './MessageBubble';

interface ChatPanelProps {
  threadPath: Message[];
  activeBranchLabel: string;
  onSendMessage: (content: string) => void;
  onBranchFromMessage: (messageId: string) => void;
  branchingFromMessageId: string | null;
  branchingFromPreview: string | null;
}

/**
 * Center column: renders the current linear context (root -> active node)
 * and exposes an input bar to send new messages.
 *
 * The parent (`App.tsx`) owns the canonical state and passes in:
 * - `threadPath`: pruned lineage of messages.
 * - current branch label (for breadcrumbs).
 * - message send/branch callbacks.
 */
export function ChatPanel({
  threadPath,
  activeBranchLabel,
  onSendMessage,
  onBranchFromMessage,
  branchingFromMessageId,
  branchingFromPreview
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadPath.length]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!input.trim()) return;
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleBranchFromMessage = (messageId: string) => {
    onBranchFromMessage(messageId);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  return (
    <main className="flex-1 flex flex-col bg-chat text-gray-100">
      {/* Top bar / breadcrumbs */}
      <header className="px-6 py-3 border-b border-gray-800 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Path</p>
          <p className="text-xs text-gray-400 mt-1">Main → {activeBranchLabel}</p>
        </div>
      </header>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
          {threadPath.map((message) => (
            <div key={message.id} className="py-1">
              <MessageBubble message={message} onBranchFromMessage={handleBranchFromMessage} />
            </div>
          ))}
          {threadPath.length === 0 && (
            <p className="text-xs text-gray-500 text-center mt-8">
              Start a new TraceBack conversation by sending a message.
            </p>
          )}
        </div>
      </div>

      {/* Input bar pinned to bottom */}
      <footer className="border-t border-gray-800 px-4 py-3">
        {branchingFromMessageId && branchingFromPreview && (
          <div className="max-w-2xl mx-auto mb-2 text-xs text-gray-500">
            Branching from: <span className="text-gray-200">“{branchingFromPreview}”</span>
          </div>
        )}
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Message TraceBack..."
              className="w-full resize-none rounded-full bg-inputBg text-sm text-gray-100 px-4 py-2 pr-10 border border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
            <button
              type="button"
              onClick={() => {
                if (!input.trim()) return;
                onSendMessage(input.trim());
                setInput('');
              }}
              className="absolute right-1.5 bottom-1.5 h-7 w-7 rounded-full bg-white text-black flex items-center justify-center text-xs hover:bg-gray-200 transition-colors"
            >
              ↑
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}

