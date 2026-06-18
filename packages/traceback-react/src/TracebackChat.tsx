import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { TreePanel } from './components/TreePanel';
import { KeyManager } from './components/KeyManager';
import { ImportPanel } from './components/ImportPanel';
import { useTraceback } from './useTraceback';

export interface TracebackChatProps {
  apiUrl: string;
}

export function TracebackChat({ apiUrl }: TracebackChatProps) {
  const tb = useTraceback({ apiUrl });

  const [treePanelWidth, setTreePanelWidth] = useState(360);
  const [treeFullscreen, setTreeFullscreen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Sidebar open/width state — width is remembered across collapses.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [incognito, setIncognito] = useState(false);

  const isTreeDragging = useRef(false);
  const isSidebarDragging = useRef(false);

  // Cmd/Ctrl+B toggles sidebar.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSidebarDividerMouseDown = useCallback(() => {
    isSidebarDragging.current = true;
    setSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMouseMove = (e: MouseEvent) => {
      if (!isSidebarDragging.current) return;
      setSidebarWidth(Math.max(180, Math.min(e.clientX, 480)));
    };
    const onMouseUp = () => {
      isSidebarDragging.current = false;
      setSidebarResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleTreeDividerMouseDown = useCallback(() => {
    isTreeDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMouseMove = (e: MouseEvent) => {
      if (!isTreeDragging.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setTreePanelWidth(Math.max(200, Math.min(newWidth, window.innerWidth * 0.6)));
    };
    const onMouseUp = () => {
      isTreeDragging.current = false;
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
      {/* Sidebar — width controlled by parent, collapses to 0 when closed */}
      {!treeFullscreen && (
        <>
          <div
            style={{ width: sidebarOpen ? sidebarWidth : 0 }}
            className={`overflow-hidden flex-shrink-0 ${!sidebarResizing ? 'transition-[width] duration-200' : ''}`}
          >
            <div style={{ width: sidebarWidth }} className="h-full">
              <Sidebar
                sessions={tb.sessions}
                activeSessionId={tb.activeSessionId}
                onNewSession={tb.handleNewSession}
                onSelectSession={tb.handleSelectSession}
                onRenameSession={tb.handleRenameSession}
                onDeleteSession={tb.handleDeleteSession}
                onOpenKeys={() => setShowKeys(true)}
                onOpenImport={() => setShowImport(true)}
              />
            </div>
          </div>

          <div
            onMouseDown={handleSidebarDividerMouseDown}
            className="w-1 cursor-col-resize bg-gray-800 hover:bg-emerald-900/50 transition-colors flex-shrink-0"
          />
        </>
      )}

      {!treeFullscreen && (
        <ChatPanel
          threadPath={tb.threadPath}
          onSendMessage={tb.handleSendMessage}
          onTranscribeAudio={tb.handleTranscribeAudio}
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
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          incognito={incognito}
          onToggleIncognito={() => setIncognito((v) => !v)}
          providers={tb.availableProviders}
          selectedProvider={tb.selectedProvider}
          selectedModel={tb.selectedModel}
          keyedProviders={tb.keyedProviders}
          onSelectModel={tb.handleSelectModel}
        />
      )}

      {!treeFullscreen && (
        <div
          onMouseDown={handleTreeDividerMouseDown}
          className="w-1 cursor-col-resize bg-gray-800 hover:bg-emerald-900/50 transition-colors flex-shrink-0"
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

      {showImport && (
        <ImportPanel onImport={tb.handleImportConversations} onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}
