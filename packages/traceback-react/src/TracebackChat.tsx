// TracebackChat: the standard, ready-to-use chat UI.
//
// Plain-English big picture:
// This is the "drop it in and it just works" interface. Give it the address of
// a Traceback server and it renders the whole experience: a sidebar of
// conversations, the chat thread in the middle, and the branching tree on the
// right. All the actual logic lives in the useTraceback hook; this component is
// only the layout. Technical users who want a different look can skip this and
// use useTraceback directly.

import { useCallback, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { TreePanel } from './components/TreePanel';
import { KeyManager } from './components/KeyManager';
import { useTraceback } from './useTraceback';

export interface TracebackChatProps {
  // Base URL of the Traceback server (e.g. "http://localhost:4000").
  apiUrl: string;
}

export function TracebackChat({ apiUrl }: TracebackChatProps) {
  const tb = useTraceback({ apiUrl });

  // Layout-only state (how wide the tree panel is, whether it is fullscreen).
  const [treePanelWidth, setTreePanelWidth] = useState(360);
  const [treeFullscreen, setTreeFullscreen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const isDragging = useRef(false);

  const handleDividerMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setTreePanelWidth(Math.max(200, Math.min(newWidth, window.innerWidth * 0.6)));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-background text-gray-100 flex">
      {!treeFullscreen && (
        <Sidebar
          sessions={tb.sessions}
          activeSessionId={tb.activeSessionId}
          onNewSession={tb.handleNewSession}
          onSelectSession={tb.handleSelectSession}
          onRenameSession={tb.handleRenameSession}
          onOpenKeys={() => setShowKeys(true)}
        />
      )}

      {!treeFullscreen && (
        <ChatPanel
          threadPath={tb.threadPath}
          onSendMessage={tb.handleSendMessage}
          onBranchFromMessage={tb.handleBranchFromMessage}
          branchingFromMessageId={tb.branchingFromMessageId}
          branchingFromPreview={tb.branchingFromPreview}
          branchingFromText={tb.branchingFromText}
          sending={tb.sending}
          error={tb.error}
          siblingInfo={tb.siblingInfo}
          onNavigateToParent={tb.handleNavigateToParent}
          onNavigateToSibling={tb.handleNavigateToSibling}
          onNavigateToNode={tb.handleNavigateToNode}
          providers={tb.availableProviders}
          selectedProvider={tb.selectedProvider}
          selectedModel={tb.selectedModel}
          keyedProviders={tb.keyedProviders}
          onSelectModel={tb.handleSelectModel}
        />
      )}

      {!treeFullscreen && (
        <div
          onMouseDown={handleDividerMouseDown}
          className="w-1.5 cursor-col-resize bg-gray-800 hover:bg-emerald-900/50 transition-colors flex-shrink-0"
        />
      )}

      <TreePanel
        nodes={tb.nodes}
        edges={tb.edges}
        activeNodeId={tb.activeNodeId}
        activePathIds={tb.activePathIds}
        onSelectNode={tb.handleSelectTreeNode}
        onDeleteSubtree={tb.handleDeleteSubtree}
        width={treeFullscreen ? window.innerWidth : treePanelWidth}
        isFullscreen={treeFullscreen}
        onToggleFullscreen={() => setTreeFullscreen((f) => !f)}
      />

      {showKeys && (
        <KeyManager
          providers={tb.availableProviders}
          keyedProviders={tb.keyedProviders}
          onSave={tb.setProviderKey}
          onClear={tb.clearProviderKey}
          onClose={() => setShowKeys(false)}
        />
      )}
    </div>
  );
}
