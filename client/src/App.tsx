import './index.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { TreePanel } from './components/TreePanel';
import {
  fetchSessions,
  createSession,
  fetchSessionMessages,
  sendMessage,
  deleteSubtree,
  type SessionResponse,
  type MessageResponse,
  type SendMessageResult
} from './api/api';
import { stripMarkdown } from './utils/text';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function App() {
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<MessageResponse[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  // Branching: stores the parent message ID + the highlighted text snippet.
  const [branchingFromMessageId, setBranchingFromMessageId] = useState<string | null>(null);
  const [branchingFromText, setBranchingFromText] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [treePanelWidth, setTreePanelWidth] = useState(360);
  const [treeFullscreen, setTreeFullscreen] = useState(false);
  const isDragging = useRef(false);

  // --- Data fetching ---

  useEffect(() => {
    fetchSessions()
      .then((s) => {
        setSessions(s);
        if (s.length > 0) setActiveSessionId(s[0].id);
      })
      .catch((err) => console.error('Failed to load sessions:', err));
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setAllMessages([]);
      setActiveNodeId(null);
      return;
    }
    fetchSessionMessages(activeSessionId)
      .then((msgs) => {
        setAllMessages(msgs);
        if (msgs.length > 0) {
          const deepest = msgs.reduce((a, b) => (a.depth >= b.depth ? a : b));
          setActiveNodeId(deepest.id);
        } else {
          setActiveNodeId(null);
        }
      })
      .catch((err) => console.error('Failed to load messages:', err));
  }, [activeSessionId]);

  // --- Derived: message lookup map ---
  const messageById = useMemo(
    () => new Map(allMessages.map((m) => [m.id, m])),
    [allMessages]
  );

  // --- Thread path: linear root -> activeNode ---
  const threadPath: ChatMessage[] = useMemo(() => {
    if (!activeNodeId || allMessages.length === 0) return [];
    const path: ChatMessage[] = [];
    let current: MessageResponse | undefined = messageById.get(activeNodeId);
    while (current) {
      path.unshift({ id: current.id, role: current.role, content: current.content });
      current = current.parentId ? messageById.get(current.parentId) : undefined;
    }
    return path;
  }, [activeNodeId, allMessages, messageById]);

  // Set of IDs on the active path (for tree edge highlighting).
  const activePathIds: Set<string> = useMemo(
    () => new Set(threadPath.map((m) => m.id)),
    [threadPath]
  );

  // --- Child count map: parentId -> number of children ---
  const childCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of allMessages) {
      if (m.parentId) {
        map.set(m.parentId, (map.get(m.parentId) ?? 0) + 1);
      }
    }
    return map;
  }, [allMessages]);

  // --- React Flow nodes (no role labels, just truncated content) ---
  const nodes: Node[] = useMemo(
    () =>
      allMessages.map((m) => ({
        id: m.id,
        type: 'custom',
        data: {
          label: (() => { const t = stripMarkdown(m.content); return t.length > 40 ? t.slice(0, 40) + '…' : t; })(),
          isActive: m.id === activeNodeId,
          childCount: childCountMap.get(m.id) ?? 0,
          isOnActivePath: activePathIds.has(m.id)
        },
        position: { x: 0, y: 0 }
      })),
    [allMessages, activeNodeId, childCountMap, activePathIds]
  );

  // --- React Flow edges ---
  const edges: Edge[] = useMemo(
    () =>
      allMessages
        .filter((m) => m.parentId)
        .map((m) => ({
          id: `e-${m.parentId}-${m.id}`,
          source: m.parentId!,
          target: m.id
        })),
    [allMessages]
  );

  // --- Branching preview (shows selected text if available) ---
  const branchingFromPreview = useMemo(() => {
    if (!branchingFromMessageId) return null;
    if (branchingFromText) return branchingFromText;
    const msg = messageById.get(branchingFromMessageId);
    if (!msg) return null;
    return msg.content.length > 40 ? `${msg.content.slice(0, 40)}…` : msg.content;
  }, [branchingFromMessageId, branchingFromText, messageById]);

  // --- Sibling navigation data ---
  const siblingInfo = useMemo(() => {
    if (!activeNodeId) return null;
    const activeMsg = messageById.get(activeNodeId);
    if (!activeMsg) return null;

    const siblings = allMessages
      .filter((m) => m.parentId === activeMsg.parentId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const currentIndex = siblings.findIndex((m) => m.id === activeNodeId);
    return {
      parentId: activeMsg.parentId,
      siblings,
      currentIndex,
      total: siblings.length
    };
  }, [activeNodeId, allMessages, messageById]);

  // --- Event handlers ---

  const handleNewSession = useCallback(async () => {
    try {
      const session = await createSession('New conversation');
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setAllMessages([]);
      setActiveNodeId(null);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setBranchingFromMessageId(null);
    setBranchingFromText(null);
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!activeSessionId || sending) return;

      const parentId = branchingFromMessageId ?? activeNodeId;
      setSending(true);
      setError(null);

      try {
        let sessionId = activeSessionId;
        if (!sessionId) {
          const session = await createSession(content.slice(0, 60));
          setSessions((prev) => [session, ...prev]);
          sessionId = session.id;
          setActiveSessionId(sessionId);
        }

        const result: SendMessageResult = await sendMessage(sessionId, content, parentId);
        setAllMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
        setActiveNodeId(result.assistantMessage.id);
        setBranchingFromMessageId(null);
        setBranchingFromText(null);
      } catch (err: any) {
        console.error('Send failed:', err);
        setError(err?.response?.data?.error ?? err?.message ?? 'Something went wrong');
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, activeNodeId, branchingFromMessageId, sending]
  );

  /**
   * Branch handler with two modes:
   * - "dig": immediately sends a question about the highlighted text (rabbit hole)
   * - "ask": pre-fills the input so the user can write a custom question about it
   */
  const handleBranchFromMessage = useCallback(
    async (messageId: string, selectedText: string, action: 'dig' | 'ask') => {
      if (!activeSessionId || sending) return;

      if (action === 'dig') {
        const prompt = `Explain this in more detail: "${selectedText}"`;
        setSending(true);
        setError(null);
        setBranchingFromMessageId(messageId);
        setBranchingFromText(selectedText);

        try {
          const result: SendMessageResult = await sendMessage(activeSessionId, prompt, messageId);
          setAllMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
          setActiveNodeId(result.assistantMessage.id);
        } catch (err: any) {
          console.error('Branch send failed:', err);
          setError(err?.response?.data?.error ?? err?.message ?? 'Something went wrong');
        } finally {
          setSending(false);
          setBranchingFromMessageId(null);
          setBranchingFromText(null);
        }
      } else {
        setBranchingFromMessageId(messageId);
        setBranchingFromText(selectedText);
      }
    },
    [activeSessionId, sending]
  );

  const handleSelectTreeNode = useCallback((nodeId: string) => {
    setActiveNodeId(nodeId);
    setBranchingFromMessageId(null);
    setBranchingFromText(null);
  }, []);

  const handleDeleteSubtree = useCallback(
    async (nodeId: string) => {
      if (!activeSessionId) return;
      try {
        await deleteSubtree(nodeId);
        const msgs = await fetchSessionMessages(activeSessionId);
        setAllMessages(msgs);
        if (nodeId === activeNodeId || !msgs.find((m) => m.id === activeNodeId)) {
          const parent = allMessages.find((m) => m.id === nodeId);
          if (parent?.parentId && msgs.find((m) => m.id === parent.parentId)) {
            setActiveNodeId(parent.parentId);
          } else if (msgs.length > 0) {
            setActiveNodeId(msgs[msgs.length - 1].id);
          } else {
            setActiveNodeId(null);
          }
        }
      } catch (err: any) {
        setError(err?.response?.data?.error ?? err?.message ?? 'Delete failed');
      }
    },
    [activeSessionId, activeNodeId, allMessages]
  );

  // Navigate to parent node.
  const handleNavigateToParent = useCallback(() => {
    if (!siblingInfo?.parentId) return;
    setActiveNodeId(siblingInfo.parentId);
    setBranchingFromMessageId(null);
    setBranchingFromText(null);
  }, [siblingInfo]);

  // Navigate to a sibling by offset (-1 = prev, +1 = next).
  const handleNavigateToSibling = useCallback(
    (offset: number) => {
      if (!siblingInfo) return;
      const newIndex = siblingInfo.currentIndex + offset;
      if (newIndex < 0 || newIndex >= siblingInfo.total) return;
      setActiveNodeId(siblingInfo.siblings[newIndex].id);
      setBranchingFromMessageId(null);
      setBranchingFromText(null);
    },
    [siblingInfo]
  );

  // Navigate to a specific node (for clickable breadcrumbs).
  const handleNavigateToNode = useCallback((nodeId: string) => {
    setActiveNodeId(nodeId);
    setBranchingFromMessageId(null);
    setBranchingFromText(null);
  }, []);

  // --- Resizable divider ---
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
    <div className="h-screen w-screen overflow-hidden bg-background text-gray-100 flex">
      {!treeFullscreen && (
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
        />
      )}

      {!treeFullscreen && (
        <ChatPanel
          threadPath={threadPath}
          onSendMessage={handleSendMessage}
          onBranchFromMessage={handleBranchFromMessage}
          branchingFromMessageId={branchingFromMessageId}
          branchingFromPreview={branchingFromPreview}
          branchingFromText={branchingFromText}
          sending={sending}
          error={error}
          siblingInfo={siblingInfo}
          onNavigateToParent={handleNavigateToParent}
          onNavigateToSibling={handleNavigateToSibling}
          onNavigateToNode={handleNavigateToNode}
        />
      )}

      {!treeFullscreen && (
        <div
          onMouseDown={handleDividerMouseDown}
          className="w-1.5 cursor-col-resize bg-gray-800 hover:bg-emerald-900/50 transition-colors flex-shrink-0"
        />
      )}

      <TreePanel
        nodes={nodes}
        edges={edges}
        activeNodeId={activeNodeId}
        activePathIds={activePathIds}
        onSelectNode={handleSelectTreeNode}
        onDeleteSubtree={handleDeleteSubtree}
        width={treeFullscreen ? window.innerWidth : treePanelWidth}
        isFullscreen={treeFullscreen}
        onToggleFullscreen={() => setTreeFullscreen((f) => !f)}
      />
    </div>
  );
}

export default App;
