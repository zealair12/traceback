import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import type { ProviderInfo, ImageAttachment } from '@traceback/shared';
import type { SiblingInfo } from '../lib/conversationTree';
import { MessageBubble } from './MessageBubble';
import { AgentTrace } from './AgentTrace';
import { NavHeader } from './NavHeader';
import { Composer } from './Composer';
import { BrandIcon } from './BrandIcon';

// Is this an agent trace step (a tool call/result), as opposed to a real reply?
const isAgentTraceStep = (m: ChatMessage) =>
  m.provider === 'agent' && (m.branchLabel === 'tool_call' || m.branchLabel === 'tool_result');

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
  guestLimitReached: boolean;
  onSignIn: () => void;
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
  agentMode: boolean;
  agentAvailable: boolean;
  onToggleAgent: () => void;
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
  guestLimitReached,
  onSignIn,
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
  onSelectModel,
  agentMode,
  agentAvailable,
  onToggleAgent
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

  // Group consecutive agent trace steps (tool calls/results) into one collapsible
  // AgentTrace; everything else (including the agent's final answer) stays a bubble.
  type RenderItem = { kind: 'trace'; steps: ChatMessage[]; key: string } | { kind: 'msg'; message: ChatMessage };
  const renderItems: RenderItem[] = [];
  let traceBuf: ChatMessage[] = [];
  for (const m of threadPath) {
    if (isAgentTraceStep(m)) {
      traceBuf.push(m);
    } else {
      if (traceBuf.length) { renderItems.push({ kind: 'trace', steps: traceBuf, key: `trace-${traceBuf[0].id}` }); traceBuf = []; }
      renderItems.push({ kind: 'msg', message: m });
    }
  }
  if (traceBuf.length) renderItems.push({ kind: 'trace', steps: traceBuf, key: `trace-${traceBuf[0].id}` });

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
      agentMode={agentMode}
      agentAvailable={agentAvailable}
      onToggleAgent={onToggleAgent}
    />
  );

  // Shown when a guest runs out of free messages: a one-click Google sign-in
  // rather than a wall of text. Signing in keeps their existing chats.
  const limitCta = (
    <div className="max-w-2xl mx-auto mb-2 flex flex-col items-center gap-1.5 text-center">
      <p className="text-[12px] text-gray-400">You have used today's free messages.</p>
      <button
        type="button"
        onClick={onSignIn}
        className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-white text-[#3c4043] text-[12px] font-medium hover:bg-gray-50 transition-colors border border-gray-200"
      >
        <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
          <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>
    </div>
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
            {guestLimitReached && limitCta}
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
              {renderItems.map((item) =>
                item.kind === 'trace' ? (
                  <AgentTrace key={item.key} steps={item.steps} />
                ) : (
                  <MessageBubble
                    key={item.message.id}
                    message={item.message}
                    onBranchFromMessage={onBranchFromMessage}
                    onResendMessage={onResendMessage}
                    onEditMessage={onEditMessage}
                    keyedProviders={keyedProviders}
                  />
                )
              )}
              {/* "Thinking…" only until a streaming assistant bubble exists — the
                  optimistic reply bubble becomes the live indicator, so we don't
                  show a second empty avatar next to it. */}
              {sending &&
                (threadPath.length === 0 || threadPath[threadPath.length - 1].role !== 'assistant') && (
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
            {guestLimitReached && limitCta}
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
