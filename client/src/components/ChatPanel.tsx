import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage } from '../App';
import { MessageBubble } from './MessageBubble';
import { NodeNavBar } from './NodeNavBar';
import { stripMarkdown } from '../utils/text';

interface SiblingInfo {
  parentId: string | null;
  currentIndex: number;
  total: number;
}

interface ChatPanelProps {
  threadPath: ChatMessage[];
  onSendMessage: (content: string) => void;
  onBranchFromMessage: (messageId: string, selectedText: string, action: 'dig' | 'ask') => void;
  branchingFromMessageId: string | null;
  branchingFromPreview: string | null;
  branchingFromText: string | null;
  sending: boolean;
  error: string | null;
  siblingInfo: SiblingInfo | null;
  onNavigateToParent: () => void;
  onNavigateToSibling: (offset: number) => void;
  onNavigateToNode: (nodeId: string) => void;
}

export function ChatPanel({
  threadPath,
  onSendMessage,
  onBranchFromMessage,
  branchingFromMessageId,
  branchingFromPreview,
  branchingFromText,
  sending,
  error,
  siblingInfo,
  onNavigateToParent,
  onNavigateToSibling,
  onNavigateToNode
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadPath.length]);

  // When branching text is set, pre-fill the input with a quoted snippet.
  useEffect(() => {
    if (branchingFromText) {
      setInput(`> "${branchingFromText}"\n\n`);
      inputRef.current?.focus();
    }
  }, [branchingFromText]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!input.trim() || sending) return;
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleBranchFromMessage = (messageId: string, selectedText: string, action: 'dig' | 'ask') => {
    onBranchFromMessage(messageId, selectedText, action);
    if (action === 'ask') {
      inputRef.current?.focus();
    }
  };

  return (
    <main className="flex-1 flex flex-col bg-chat text-gray-100 min-w-0">
      {/* Clickable breadcrumb trail */}
      <header className="px-6 py-2.5 border-b border-gray-800 flex-shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1 text-[11px] min-w-0">
          {threadPath.length === 0 ? (
            <span className="text-gray-600">No messages yet</span>
          ) : (
            threadPath.map((msg, i) => {
              const isLast = i === threadPath.length - 1;
              const clean = stripMarkdown(msg.content);
              const label = clean.length > 20 ? clean.slice(0, 20) + '…' : clean;

              return (
                <span key={msg.id} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <span className="text-gray-700 flex-shrink-0">›</span>}
                  <button
                    type="button"
                    onClick={() => onNavigateToNode(msg.id)}
                    className={`truncate max-w-[140px] transition-colors ${
                      isLast
                        ? 'text-gray-200 font-medium'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                </span>
              );
            })
          )}
        </div>
      </header>

      {/* Parent/sibling navigation bar */}
      <NodeNavBar
        siblingInfo={siblingInfo}
        onNavigateToParent={onNavigateToParent}
        onNavigateToSibling={onNavigateToSibling}
      />

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
          {threadPath.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onBranchFromMessage={handleBranchFromMessage}
            />
          ))}
          {sending && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-[10px] text-gray-400 mt-1 flex-shrink-0">
                TB
              </div>
              <div className="text-sm text-gray-500 animate-pulse">Thinking…</div>
            </div>
          )}
          {threadPath.length === 0 && !sending && (
            <p className="text-sm text-gray-500 text-center pt-24">
              Start a new conversation by sending a message below.
            </p>
          )}
        </div>
      </div>

      {/* Input bar */}
      <footer className="border-t border-gray-800 px-4 py-3 flex-shrink-0">
        {error && (
          <div className="max-w-2xl mx-auto mb-2 text-xs text-red-400 bg-red-400/10 rounded-md px-3 py-1.5">
            {error}
          </div>
        )}
        {branchingFromMessageId && branchingFromPreview && (
          <div className="max-w-2xl mx-auto mb-2 text-xs text-emerald-400 flex items-center gap-1.5">
            <span>⎇</span>
            <span>Branching from:</span>
            <span className="text-gray-300 truncate max-w-[300px]">"{branchingFromPreview}"</span>
          </div>
        )}
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={input.includes('\n') ? 3 : 1}
              placeholder="Message TraceBack..."
              disabled={sending}
              className="w-full resize-none rounded-2xl bg-inputBg text-sm text-gray-100 px-4 py-2.5 pr-10 border border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-600 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={sending || !input.trim()}
              onClick={() => {
                if (!input.trim() || sending) return;
                onSendMessage(input.trim());
                setInput('');
              }}
              className="absolute right-2 bottom-2 h-7 w-7 rounded-full bg-white text-black flex items-center justify-center text-xs hover:bg-gray-200 transition-colors disabled:opacity-30"
            >
              ↑
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
