import { useEffect, useRef, useState } from 'react';
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
  onResendMessage: (messageId: string) => void;
  onEditMessage: (messageId: string, newContent: string) => void;
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
  treePanelVisible: boolean;
  onToggleTreePanel: () => void;
  incognito: boolean;
  onToggleIncognito: () => void;
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
  onResendMessage,
  onEditMessage,
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
  treePanelVisible,
  onToggleTreePanel,
  incognito,
  onToggleIncognito,
  providers,
  selectedProvider,
  selectedModel,
  keyedProviders,
  onSelectModel
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // One-time "how to branch" tip. Dismissed permanently once seen or closed.
  const [hintDismissed, setHintDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('tb-hint-branch') === 'seen'
  );
  const dismissHint = () => {
    setHintDismissed(true);
    try { localStorage.setItem('tb-hint-branch', 'seen'); } catch { /* ignore */ }
  };
  // Only worth showing once there is a reply to branch from.
  const showBranchHint =
    !hintDismissed && !branchingFromMessageId && threadPath.some((m) => m.role === 'assistant');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadPath.length]);

  const isEmpty = threadPath.length === 0 && !sending;

  const composer = (
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
  );

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
        treePanelVisible={treePanelVisible}
        onToggleTreePanel={onToggleTreePanel}
        incognito={incognito}
        onToggleIncognito={onToggleIncognito}
      />

      {isEmpty ? (
        /* Empty state: composer floats in the vertical center */
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
          <div className="w-full max-w-2xl">
            {error && (
              <div className="mb-2 text-xs text-red-400 bg-red-400/10 rounded-md px-3 py-1.5">
                {error}
              </div>
            )}
            {composer}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 h-0 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-4 pt-4 pb-2 space-y-5">
              {threadPath.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onBranchFromMessage={onBranchFromMessage}
                  onResendMessage={onResendMessage}
                  onEditMessage={onEditMessage}
                  keyedProviders={keyedProviders}
                />
              ))}
              {sending && (
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-blue-400 mt-1 flex-shrink-0">
                    <BrandIcon size={15} />
                  </div>
                  <div className="text-sm text-gray-500 animate-pulse">Thinking…</div>
                </div>
              )}
            </div>
          </div>

          <footer className="px-4 py-3 flex-shrink-0">
            {error && (
              <div className="max-w-2xl mx-auto mb-2 text-xs text-red-400 bg-red-400/10 rounded-md px-3 py-1.5">
                {error}
              </div>
            )}
            {showBranchHint && (
              /* Desktop only: "hover" is meaningless on touch, so mobile gets a
                 pulse on the graph icon (NavHeader) instead. */
              <div className="max-w-2xl mx-auto mb-2 hidden md:flex items-center justify-between gap-3 text-[11px] text-gray-400 bg-gray-500/10 rounded-md px-3 py-1.5">
                <span>
                  Tip: hover any reply and click <span className="text-gray-200">⎇ Branch</span>, or select any text in a reply, to take the chat a new direction.
                </span>
                <button
                  type="button"
                  onClick={dismissHint}
                  className="text-gray-500 hover:text-gray-200 flex-shrink-0 leading-none text-sm"
                  aria-label="Dismiss tip"
                >
                  ×
                </button>
              </div>
            )}
            {branchingFromMessageId && branchingFromPreview && (
              <div className="max-w-2xl mx-auto mb-2 text-xs text-gray-400 flex items-center gap-1.5">
                <span>⎇</span>
                <span>Branching from:</span>
                <span className="text-gray-300 truncate max-w-[300px]">"{branchingFromPreview}"</span>
              </div>
            )}
            <div className="max-w-2xl mx-auto">{composer}</div>
          </footer>
        </>
      )}
    </main>
  );
}
