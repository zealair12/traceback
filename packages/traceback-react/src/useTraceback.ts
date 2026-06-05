// useTraceback: the headless "engine" hook.
//
// Plain-English big picture:
// This hook contains ALL the logic of a Traceback conversation -- loading
// sessions, tracking where you are in the branching tree, sending messages to a
// chosen model, branching, deleting, navigating -- but renders NOTHING. It hands
// back plain data and action functions. The standard <TracebackChat> UI is built
// on top of it, but a technical user can call this hook directly and build their
// own interface around the same engine. You only have to tell it the address of
// a Traceback server (apiUrl).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import {
  createTracebackClient,
  type SessionResponse,
  type MessageResponse,
  type SendMessageResult,
  type ProviderInfo
} from '@traceback/shared';
import { stripMarkdown } from './utils/text';
import type { ChatMessage } from './types';

function isUntitledSessionName(name: string | null): boolean {
  return !name || !name.trim() || name.trim().toLowerCase() === 'new conversation';
}

function summarizeTopic(text: string): string {
  const clean = stripMarkdown(text).replace(/\s+/g, ' ').trim();
  if (!clean) return 'Untitled';
  const simplified = clean.replace(/^(what is|how to|can you|please|explain|help me)\s+/i, '');
  const words = simplified.split(' ').slice(0, 6).join(' ');
  const titled = words.charAt(0).toUpperCase() + words.slice(1);
  return titled.replace(/[?.!,;:]+$/, '') || 'Untitled';
}

export interface UseTracebackOptions {
  // Base URL of the Traceback server (e.g. "http://localhost:4000").
  apiUrl: string;
}

export function useTraceback({ apiUrl }: UseTracebackOptions) {
  // One HTTP client per server address. Rebuilt only if the address changes.
  const client = useMemo(() => createTracebackClient(apiUrl), [apiUrl]);

  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<MessageResponse[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const [branchingFromMessageId, setBranchingFromMessageId] = useState<string | null>(null);
  const [branchingFromText, setBranchingFromText] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Load providers once (per client) and default the picker to the server's
  // default backend + that backend's default model.
  useEffect(() => {
    client
      .fetchProviders()
      .then((res) => {
        setAvailableProviders(res.providers);
        const def = res.providers.find((p) => p.id === res.default) ?? res.providers[0];
        if (def) {
          setSelectedProvider(def.id);
          setSelectedModel(def.defaultModel);
        }
      })
      .catch((err) => console.error('Failed to load providers:', err));
  }, [client]);

  // Picking an entry from the single model dropdown sets backend + model at once.
  const handleSelectModel = useCallback((providerId: string, model: string) => {
    setSelectedProvider(providerId);
    setSelectedModel(model);
  }, []);

  // Load the session list, backfilling names for old unnamed sessions.
  useEffect(() => {
    client
      .fetchSessions()
      .then(async (s) => {
        setSessions(s);
        if (s.length > 0) setActiveSessionId(s[0].id);

        const unnamed = s.filter((x) => isUntitledSessionName(x.name));
        if (unnamed.length === 0) return;
        const updates = await Promise.allSettled(
          unnamed.map(async (session) => {
            const msgs = await client.fetchSessionMessages(session.id);
            const firstUser = msgs.find((m) => m.role === 'user');
            if (!firstUser) return null;
            const name = summarizeTopic(firstUser.content);
            const updated = await client.updateSessionName(session.id, name);
            return { id: updated.id, name: updated.name };
          })
        );
        setSessions((prev) =>
          prev.map((session) => {
            const hit = updates
              .filter(
                (u): u is PromiseFulfilledResult<{ id: string; name: string | null } | null> =>
                  u.status === 'fulfilled'
              )
              .map((u) => u.value)
              .find((u) => u && u.id === session.id);
            return hit ? { ...session, name: hit.name } : session;
          })
        );
      })
      .catch((err) => console.error('Failed to load sessions:', err));
  }, [client]);

  // Load messages whenever the active session changes.
  useEffect(() => {
    if (!activeSessionId) {
      setAllMessages([]);
      setActiveNodeId(null);
      return;
    }
    client
      .fetchSessionMessages(activeSessionId)
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
  }, [client, activeSessionId]);

  const messageById = useMemo(
    () => new Map(allMessages.map((m) => [m.id, m])),
    [allMessages]
  );

  // The linear path from the root down to the active node -- this is the thread
  // the chat panel shows (and mirrors the pruned context the server uses).
  const threadPath: ChatMessage[] = useMemo(() => {
    if (!activeNodeId || allMessages.length === 0) return [];
    const path: ChatMessage[] = [];
    let current: MessageResponse | undefined = messageById.get(activeNodeId);
    while (current) {
      path.unshift({
        id: current.id,
        role: current.role,
        content: current.content,
        provider: current.provider,
        model: current.model
      });
      current = current.parentId ? messageById.get(current.parentId) : undefined;
    }
    return path;
  }, [activeNodeId, allMessages, messageById]);

  const activePathIds: Set<string> = useMemo(
    () => new Set(threadPath.map((m) => m.id)),
    [threadPath]
  );

  const userMessages = useMemo(
    () => allMessages.filter((m) => m.role === 'user'),
    [allMessages]
  );
  const userMessageIds = useMemo(
    () => new Set(userMessages.map((m) => m.id)),
    [userMessages]
  );

  // For each question, find its nearest question ancestor so the tree connects
  // questions to questions (skipping the assistant replies in between).
  const userParentMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of userMessages) {
      let cur = m.parentId;
      while (cur) {
        if (userMessageIds.has(cur)) {
          map.set(m.id, cur);
          break;
        }
        const parent = messageById.get(cur);
        cur = parent?.parentId ?? null;
      }
      if (!map.has(m.id)) map.set(m.id, null);
    }
    return map;
  }, [userMessages, userMessageIds, messageById]);

  const nodes: Node[] = useMemo(
    () =>
      userMessages.map((m) => {
        const t = stripMarkdown(m.content);
        const d = new Date(m.createdAt);
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return {
          id: m.id,
          type: 'custom',
          data: {
            label: t.length > 40 ? t.slice(0, 40) + '…' : t,
            timestamp: time,
            isActive: m.id === activeNodeId || activePathIds.has(m.id),
            isOnActivePath: activePathIds.has(m.id)
          },
          position: { x: 0, y: 0 }
        };
      }),
    [userMessages, activeNodeId, activePathIds]
  );

  const edges: Edge[] = useMemo(
    () =>
      userMessages
        .filter((m) => userParentMap.get(m.id))
        .map((m) => ({
          id: `e-${userParentMap.get(m.id)}-${m.id}`,
          source: userParentMap.get(m.id)!,
          target: m.id
        })),
    [userMessages, userParentMap]
  );

  const branchingFromPreview = useMemo(() => {
    if (!branchingFromMessageId) return null;
    if (branchingFromText) return branchingFromText;
    const msg = messageById.get(branchingFromMessageId);
    if (!msg) return null;
    return msg.content.length > 40 ? `${msg.content.slice(0, 40)}…` : msg.content;
  }, [branchingFromMessageId, branchingFromText, messageById]);

  const siblingInfo = useMemo(() => {
    if (!activeNodeId) return null;
    const activeMsg = messageById.get(activeNodeId);
    if (!activeMsg) return null;
    const siblings = allMessages
      .filter((m) => m.parentId === activeMsg.parentId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const currentIndex = siblings.findIndex((m) => m.id === activeNodeId);
    return { parentId: activeMsg.parentId, siblings, currentIndex, total: siblings.length };
  }, [activeNodeId, allMessages, messageById]);

  const handleNewSession = useCallback(async () => {
    try {
      const session = await client.createSession();
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setAllMessages([]);
      setActiveNodeId(null);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [client]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setBranchingFromMessageId(null);
    setBranchingFromText(null);
  }, []);

  const handleRenameSession = useCallback(
    async (sessionId: string, name: string) => {
      try {
        const updated = await client.updateSessionName(sessionId, name.trim() || null);
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
      } catch (err) {
        console.error('Failed to rename session:', err);
      }
    },
    [client]
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!activeSessionId || sending) return;
      const parentId = branchingFromMessageId ?? activeNodeId;
      setSending(true);
      setError(null);
      try {
        const sessionId = activeSessionId;
        const result: SendMessageResult = await client.sendMessage(sessionId, content, parentId, {
          provider: selectedProvider ?? undefined,
          model: selectedModel ?? undefined
        });
        setAllMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
        setActiveNodeId(result.assistantMessage.id);
        setBranchingFromMessageId(null);
        setBranchingFromText(null);

        const current = sessions.find((s) => s.id === sessionId);
        if (current && isUntitledSessionName(current.name)) {
          const auto = summarizeTopic(content);
          const updated = await client.updateSessionName(sessionId, auto);
          setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
        }
      } catch (err: any) {
        console.error('Send failed:', err);
        setError(err?.response?.data?.error ?? err?.message ?? 'Something went wrong');
      } finally {
        setSending(false);
      }
    },
    [client, activeSessionId, activeNodeId, branchingFromMessageId, sending, sessions, selectedProvider, selectedModel]
  );

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
          const result: SendMessageResult = await client.sendMessage(activeSessionId, prompt, messageId, {
            provider: selectedProvider ?? undefined,
            model: selectedModel ?? undefined
          });
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
    [client, activeSessionId, sending, selectedProvider, selectedModel]
  );

  const handleSelectTreeNode = useCallback(
    (nodeId: string) => {
      const assistantChild = allMessages.find((m) => m.parentId === nodeId && m.role === 'assistant');
      setActiveNodeId(assistantChild?.id ?? nodeId);
      setBranchingFromMessageId(null);
      setBranchingFromText(null);
    },
    [allMessages]
  );

  const handleDeleteSubtree = useCallback(
    async (nodeId: string) => {
      if (!activeSessionId) return;
      try {
        await client.deleteSubtree(nodeId);
        const msgs = await client.fetchSessionMessages(activeSessionId);
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
    [client, activeSessionId, activeNodeId, allMessages]
  );

  const handleNavigateToParent = useCallback(() => {
    if (!siblingInfo?.parentId) return;
    setActiveNodeId(siblingInfo.parentId);
    setBranchingFromMessageId(null);
    setBranchingFromText(null);
  }, [siblingInfo]);

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

  const handleNavigateToNode = useCallback((nodeId: string) => {
    setActiveNodeId(nodeId);
    setBranchingFromMessageId(null);
    setBranchingFromText(null);
  }, []);

  return {
    // data
    sessions,
    activeSessionId,
    allMessages,
    activeNodeId,
    threadPath,
    activePathIds,
    nodes,
    edges,
    branchingFromMessageId,
    branchingFromPreview,
    branchingFromText,
    sending,
    error,
    siblingInfo,
    availableProviders,
    selectedProvider,
    selectedModel,
    // actions
    handleNewSession,
    handleSelectSession,
    handleRenameSession,
    handleSendMessage,
    handleBranchFromMessage,
    handleSelectTreeNode,
    handleDeleteSubtree,
    handleNavigateToParent,
    handleNavigateToSibling,
    handleNavigateToNode,
    handleSelectModel
  };
}

export type UseTracebackReturn = ReturnType<typeof useTraceback>;
