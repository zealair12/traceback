import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { TreePanel, treeConnectorColor } from './components/TreePanel';
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

  const isMobile = () => window.innerWidth < 768;

  // Sidebar open/width state — hidden by default on mobile.
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobile());
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [sidebarResizing, setSidebarResizing] = useState(false);

  // Tree panel visible — hidden by default on mobile; toggled via NavHeader button.
  const [treePanelVisible, setTreePanelVisible] = useState(() => !isMobile());

  // Track viewport width so layout (and inline widths) recompute on rotation.
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => {
      setViewportW(window.innerWidth);
      // Back on a wide screen: drop the mobile full-screen tree so the normal
      // side-by-side layout returns cleanly after a rotate.
      if (window.innerWidth >= 768) setTreeFullscreen(false);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  type Theme = 'dark' | 'blue' | 'light';
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('tb-theme') as Theme | null) ?? 'dark'
  );

  const handleSetTheme = useCallback((t: Theme) => {
    setTheme(t);
    localStorage.setItem('tb-theme', t);
    const bgMap = { dark: '#0d0d0d', blue: '#060c1a', light: '#f7f8fa' };
    document.body.style.backgroundColor = bgMap[t];
    // Keep data-theme on body so portals (Float/Modal) inherit theme variables.
    document.body.setAttribute('data-theme', t);
  }, []);

  useEffect(() => {
    const bgMap = { dark: '#0d0d0d', blue: '#060c1a', light: '#f7f8fa' };
    document.body.style.backgroundColor = bgMap[theme];
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  const isTreeDragging = useRef(false);
  const isSidebarDragging = useRef(false);

  // Keyboard: Cmd/Ctrl+B toggles the sidebar; Escape backs out of whatever
  // overlay is open so the flow never gets stuck (fullscreen tree, then the
  // mobile tree overlay, then the mobile sidebar).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        if (treeFullscreen) { setTreeFullscreen(false); return; }
        if (treePanelVisible && isMobile()) { setTreePanelVisible(false); return; }
        if (sidebarOpen && isMobile()) { setSidebarOpen(false); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [treeFullscreen, treePanelVisible, sidebarOpen]);

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
      // Drag past 85% → snap to fullscreen
      if (newWidth > window.innerWidth * 0.85) {
        setTreeFullscreen(true);
        return;
      }
      // Drag below 150px → hide the panel
      if (newWidth < 150) {
        setTreePanelVisible(false);
        return;
      }
      setTreePanelWidth(Math.max(200, Math.min(newWidth, window.innerWidth * 0.7)));
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

  // Touch-drag for the tree divider. On mobile the panel is already full-screen
  // so this only applies on desktop-sized touch screens (e.g. tablets).
  const handleTreeDividerTouchStart = useCallback((_e: React.TouchEvent) => {
    isTreeDragging.current = true;
    document.body.style.userSelect = 'none';
    const onTouchMove = (ev: TouchEvent) => {
      if (!isTreeDragging.current) return;
      ev.preventDefault();
      const newWidth = window.innerWidth - ev.touches[0].clientX;
      if (newWidth > window.innerWidth * 0.85) { setTreeFullscreen(true); return; }
      if (newWidth < 150) { setTreePanelVisible(false); return; }
      setTreePanelWidth(Math.max(200, Math.min(newWidth, window.innerWidth * 0.7)));
    };
    const onTouchEnd = () => {
      isTreeDragging.current = false;
      document.body.style.userSelect = '';
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-background text-gray-100 flex" data-theme={theme}>
      {/* Sidebar — overlays on mobile, in-flow flex child on desktop */}
      {!treeFullscreen && (
        <>
          {/* Mobile backdrop: tap outside to close sidebar */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* On mobile (< md): fixed overlay; on desktop: in-flow flex child */}
          <div
            style={{ width: sidebarOpen ? sidebarWidth : 0 }}
            className={`
              overflow-hidden flex-shrink-0
              max-md:fixed max-md:left-0 max-md:top-0 max-md:h-full max-md:z-50
              ${!sidebarResizing ? 'transition-[width] duration-200' : ''}
            `}
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
                theme={theme}
                onSetTheme={handleSetTheme}
                authState={tb.authState}
                onSignIn={tb.handleSignIn}
                onSignOut={tb.handleSignOut}
              />
            </div>
          </div>

          {/* Resize divider — desktop only; wider hit area, thin visual line */}
          <div
            onMouseDown={handleSidebarDividerMouseDown}
            className="hidden md:flex w-5 flex-shrink-0 cursor-col-resize items-center justify-center group"
          >
            <div className="w-px h-full transition-colors" style={{ backgroundColor: treeConnectorColor(theme) }} />
          </div>
        </>
      )}

      {!treeFullscreen && (
        <ChatPanel
          threadPath={tb.threadPath}
          onSendMessage={tb.handleSendMessage}
          onTranscribeAudio={tb.handleTranscribeAudio}
          onBranchFromMessage={tb.handleBranchFromMessage}
          onResendMessage={tb.handleResendMessage}
          onEditMessage={tb.handleEditMessage}
          branchingFromMessageId={tb.branchingFromMessageId}
          branchingFromPreview={tb.branchingFromPreview}
          branchingFromText={tb.branchingFromText}
          sending={tb.sending}
          error={tb.error}
          guestLimitReached={tb.guestLimitReached}
          onSignIn={tb.handleSignIn}
          siblingInfo={tb.siblingInfo}
          onNavigateToParent={tb.handleNavigateToParent}
          onNavigateToSibling={tb.handleNavigateToSibling}
          onNavigateToNode={tb.handleNavigateToNode}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          treePanelVisible={treePanelVisible}
          onToggleTreePanel={() => setTreePanelVisible((v) => !v)}
          incognito={tb.incognito}
          onToggleIncognito={tb.handleToggleIncognito}
          providers={tb.availableProviders}
          selectedProvider={tb.selectedProvider}
          selectedModel={tb.selectedModel}
          keyedProviders={tb.keyedProviders}
          onSelectModel={tb.handleSelectModel}
          agentMode={tb.agentMode}
          agentAvailable={tb.agentAvailable}
          onToggleAgent={tb.toggleAgentMode}
        />
      )}

      {/* Tree divider — desktop only; hidden on mobile where tree is full-screen */}
      {!treeFullscreen && treePanelVisible && (
        <div
          onMouseDown={handleTreeDividerMouseDown}
          onTouchStart={handleTreeDividerTouchStart}
          className="hidden md:flex w-5 flex-shrink-0 cursor-col-resize items-center justify-center group"
        >
          <div className="w-px h-full transition-colors" style={{ backgroundColor: treeConnectorColor(theme) }} />
        </div>
      )}

      {(treePanelVisible || treeFullscreen) && (
        <>
          {/* Mobile: dim backdrop behind the tree — tap to close */}
          {treePanelVisible && !treeFullscreen && (
            <div
              className="fixed inset-0 z-20 bg-black/40 md:hidden"
              onClick={() => setTreePanelVisible(false)}
            />
          )}

          {/* On mobile: fixed full-screen overlay (z-30, above backdrop).
              On desktop: normal flex child at treePanelWidth. */}
          <div className="max-md:fixed max-md:inset-0 max-md:z-30 max-md:flex md:contents">
            <TreePanel
              nodes={tb.nodes}
              edges={tb.edges}
              activeNodeId={tb.activeNodeId}
              activePathIds={tb.activePathIds}
              onSelectNode={(nodeId) => {
                tb.handleSelectTreeNode(nodeId);
                // On mobile the tree is a full-screen overlay — close it so
                // the user lands back in the chat after picking a node.
                if (window.innerWidth < 768) setTreePanelVisible(false);
              }}
              onDeleteSubtree={tb.handleDeleteSubtree}
              width={treeFullscreen ? viewportW : viewportW < 768 ? viewportW : treePanelWidth}
              isFullscreen={treeFullscreen}
              onToggleFullscreen={() => setTreeFullscreen((f) => !f)}
              onClose={() => { setTreePanelVisible(false); setTreeFullscreen(false); }}
              theme={theme}
            />
          </div>
        </>
      )}

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
