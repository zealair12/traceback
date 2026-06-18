// The middle column: navigation line on top, the conversation thread, and the
// composer at the bottom. Each piece is its own component; this file only
// arranges them.

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';
import type { ProviderInfo, ImageAttachment } from '@traceback/shared';
import type { SiblingInfo } from '../lib/conversationTree';
import { MessageBubble } from './MessageBubble';
import { NavHeader } from './NavHeader';
import { Composer } from './Composer';
import { BrandIcon } from './BrandIcon';

interface ChatPanelProps {
  threadPath: ChatMessage[];
  onSendMessage: (content: string, attachments?: ImageAttachment[]) => void;
  onTranscribeAudio: (audioDataUrl: string, mediaType: string) => Promise<string>;
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
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  // Model picker.
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  keyedProviders: Set<string>;
  onSelectModel: (providerId: string, model: string) => void;
}

export function ChatPanel({
  threadPath,
  onSendMessage,
  onTranscribeAudio,
  onBranchFromMessage,
  branchingFromMessageId,
  branchingFromPreview,
  branchingFromText,
  sending,
  error,
  siblingInfo,
  onNavigateToParent,
  onNavigateToSibling,
  onNavigateToNode,
  sidebarOpen,
  onToggleSidebar,
  providers,
  selectedProvider,
  selectedModel,
  keyedProviders,
  onSelectModel
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadPath.length]);

  return (
    <main className="flex-1 flex flex-col bg-chat text-gray-100 min-w-0">
      <NavHeader
        threadPath={threadPath}
        siblingInfo={siblingInfo}
        onNavigateToParent={onNavigateToParent}
        onNavigateToSibling={onNavigateToSibling}
        onNavigateToNode={onNavigateToNode}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
      />

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-2 space-y-5">
          {threadPath.map((message) => (
            <MessageBubble key={message.id} message={message} onBranchFromMessage={onBranchFromMessage} />
          ))}
          {sending && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-blue-400 mt-1 flex-shrink-0">
                <BrandIcon size={15} />
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
      <footer className="px-4 py-3 flex-shrink-0">
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
        <Composer
          sending={sending}
          branchingFromMessageId={branchingFromMessageId}
          branchingFromText={branchingFromText}
          onSendMessage={onSendMessage}
          onTranscribeAudio={onTranscribeAudio}
          providers={providers}
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          keyedProviders={keyedProviders}
          onSelectModel={onSelectModel}
        />
      </footer>
    </main>
  );
}
