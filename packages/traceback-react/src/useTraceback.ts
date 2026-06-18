// useTraceback: the headless "engine" hook.
//
// Plain-English big picture:
// This hook owns the STATE of a Traceback conversation -- which session is
// open, where you are in the tree, what is being sent -- and the ACTIONS that
// change it. Everything derivable is computed by plain classes it leans on:
// ConversationTree (the tree math), ModelRouter (which model answers), and
// KeyStore (the user's own keys). The standard <TracebackChat> UI is built on
// this hook, but a technical user can call it directly -- or skip React
// entirely and use the classes -- and get the same engine.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTracebackClient,
  type SessionResponse,
  type MessageResponse,
  type SendMessageResult,
  type ProviderInfo,
  type ImportedConversation,
  type ImageAttachment
} from '@traceback/shared';
import { ConversationTree } from './lib/conversationTree';
import { ModelRouter } from './lib/modelRouter';
import { keyStore } from './lib/keyStore';
import { isUntitledSessionName, summarizeTopic } from './lib/naming';

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

  // Incognito: creates a throwaway session that is deleted when toggled off.
  const [incognito, setIncognito] = useState(false);
  const [incognitoSessionId, setIncognitoSessionId] = useState<string | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);

  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [serverDefaultProvider, setServerDefaultProvider] = useState<string | null>(null);
  // Which backends the user has saved their own key for (in this browser tab).
  const [keyedProviders, setKeyedProviders] = useState<Set<string>>(new Set());

  // Load providers once and default the picker to the server's default
  // backend + that backend's default model.
  useEffect(() => {
    client
      .fetchProviders()
      .then((res) => {
        setAvailableProviders(res.providers);
        setServerDefaultProvider(res.default);
        const def = res.providers.find((p) => p.id === res.default) ?? res.providers[0];
        if (def) {
          setSelectedProvider(def.id);
          setSelectedModel(def.defaultModel);
        }
        setKeyedProviders(keyStore.keyedAmong(res.providers.map((p) => p.id)));
      })
      .catch((err) => console.error('Failed to load providers:', err));
  }, [client]);

  // Load the session list. Auto-creates one if the DB is empty so new users
  // always land in an active chat without a manual "New Chat" step.
  useEffect(() => {
    client
      .fetchSessions()
      .then(async (s) => {
        if (s.length === 0) {
          const newSession = await client.createSession();
          setSessions([newSession]);
          setActiveSessionId(newSession.id);
          return;
        }
        setSessions(s);
        setActiveSessionId(s[0].id);

        const unnamed = s.filter((x) => isUntitledSessionName(x.name));
        if (unnamed.length === 0) return;
        const updates = await Promise.allSettled(
          unnamed.map(async (session) => {
            const msgs = await client.fetchSessionMessages(session.id);
            const firstUser = msgs.find((m) => m.role === 'user');
            if (!firstUser) return null;
            const updated = await client.updateSessionName(session.id, summarizeTopic(firstUser.content));
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
        const deepest = msgs.length
          ? msgs.reduce((a, b) => (a.depth >= b.depth ? a : b))
          : null;
        setActiveNodeId(deepest ? deepest.id : null);
      })
      .catch((err) => console.error('Failed to load messages:', err));
  }, [client, activeSessionId]);

  // All tree math lives in one plain class.
  const tree = useMemo(
    () => new ConversationTree(allMessages, activeNodeId),
    [allMessages, activeNodeId]
  );

  // Which backend/model a message actually goes to (Auto resolves here).
  const router = useMemo(
    () => new ModelRouter(availableProviders, keyedProviders, serverDefaultProvider),
    [availableProviders, keyedProviders, serverDefaultProvider]
  );

  const messageById = useMemo(() => new Map(allMessages.map((m) => [m.id, m])), [allMessages]);
  const branchingFromPreview = useMemo(() => {
    if (!branchingFromMessageId) return null;
    if (branchingFromText) return branchingFromText;
    const msg = messageById.get(branchingFromMessageId);
    if (!msg) return null;
    return msg.content.length > 40 ? `${msg.content.slice(0, 40)}…` : msg.content;
  }, [branchingFromMessageId, branchingFromText, messageById]);

  const clearBranching = useCallback(() => {
    setBranchingFromMessageId(null);
    setBranchingFromText(null);
  }, []);

  // Picking an entry from the model dropdown sets backend + model at once.
  const handleSelectModel = useCallback((providerId: string, model: string) => {
    setSelectedProvider(providerId);
    setSelectedModel(model);
  }, []);

  // Save / clear a user's own API key for a backend (browser-only storage).
  const setProviderKey = useCallback((providerId: string, key: string) => {
    keyStore.set(providerId, key);
    setKeyedProviders((prev) => new Set(prev).add(providerId));
  }, []);

  const clearProviderKey = useCallback((providerId: string) => {
    keyStore.clear(providerId);
    setKeyedProviders((prev) => {
      const next = new Set(prev);
      next.delete(providerId);
      return next;
    });
  }, []);

  // Turn recorded audio (or an audio file) into text. The user's stored Groq
  // or OpenAI key is sent when present.
  const handleTranscribeAudio = useCallback(
    async (audioDataUrl: string, mediaType: string): Promise<string> => {
      const key = keyStore.get('groq') ?? keyStore.get('openai') ?? undefined;
      const result = await client.transcribeAudio(audioDataUrl, mediaType, { apiKey: key });
      return result.text;
    },
    [client]
  );

  // Write imported conversations to the server, refresh, and jump to the
  // first imported one. Returns how many were imported.
  const handleImportConversations = useCallback(
    async (conversations: ImportedConversation[]): Promise<number> => {
      const result = await client.importConversations(conversations);
      setSessions(await client.fetchSessions());
      if (result.imported.length > 0) setActiveSessionId(result.imported[0].sessionId);
      return result.imported.length;
    },
    [client]
  );

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

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      clearBranching();
    },
    [clearBranching]
  );

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

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await client.deleteSession(sessionId);
        const remaining = sessions.filter((s) => s.id !== sessionId);
        if (remaining.length === 0) {
          const newSession = await client.createSession();
          setSessions([newSession]);
          setActiveSessionId(newSession.id);
          setAllMessages([]);
          setActiveNodeId(null);
        } else {
          setSessions(remaining);
          if (activeSessionId === sessionId) setActiveSessionId(remaining[0].id);
        }
      } catch (err: any) {
        setError(err?.response?.data?.error ?? err?.message ?? 'Delete failed');
      }
    },
    [client, sessions, activeSessionId]
  );

  // Shared core of "send a message": route it, send it, place the reply.
  const send = useCallback(
    async (sessionId: string, content: string, parentId: string | null, attachments?: ImageAttachment[]) => {
      const choice = router.resolve(
        { provider: selectedProvider, model: selectedModel },
        (attachments ?? []).some((a) => a.type === 'image'),
        (attachments ?? []).some((a) => a.type === 'file')
      );
      const result: SendMessageResult = await client.sendMessage(sessionId, content, parentId, {
        provider: choice.provider,
        model: choice.model,
        attachments,
        apiKey: (choice.provider && keyStore.get(choice.provider)) || undefined
      });
      setAllMessages((prev) => [...prev, result.userMessage, result.assistantMessage]);
      setActiveNodeId(result.assistantMessage.id);
      clearBranching();
    },
    [client, router, selectedProvider, selectedModel, clearBranching]
  );

  const handleSendMessage = useCallback(
    async (content: string, attachments?: ImageAttachment[]) => {
      if (!activeSessionId || sending) return;
      const parentId = branchingFromMessageId ?? activeNodeId;
      setSending(true);
      setError(null);
      try {
        await send(activeSessionId, content, parentId, attachments);
        // Auto-name the session from its first question.
        const current = sessions.find((s) => s.id === activeSessionId);
        if (current && isUntitledSessionName(current.name)) {
          const updated = await client.updateSessionName(activeSessionId, summarizeTopic(content));
          setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? updated : s)));
        }
      } catch (err: any) {
        console.error('Send failed:', err);
        setError(err?.response?.data?.error ?? err?.message ?? 'Something went wrong');
      } finally {
        setSending(false);
      }
    },
    [activeSessionId, sending, branchingFromMessageId, activeNodeId, send, sessions, client]
  );

  // Branching: "dig" sends a follow-up about the selected text immediately;
  // "ask" pre-fills the input so the user writes their own question.
  const handleBranchFromMessage = useCallback(
    async (messageId: string, selectedText: string, action: 'dig' | 'ask') => {
      if (!activeSessionId || sending) return;
      if (action === 'ask') {
        setBranchingFromMessageId(messageId);
        setBranchingFromText(selectedText);
        return;
      }
      setSending(true);
      setError(null);
      setBranchingFromMessageId(messageId);
      setBranchingFromText(selectedText);
      try {
        await send(activeSessionId, `Explain this in more detail: "${selectedText}"`, messageId);
      } catch (err: any) {
        console.error('Branch send failed:', err);
        setError(err?.response?.data?.error ?? err?.message ?? 'Something went wrong');
      } finally {
        setSending(false);
        clearBranching();
      }
    },
    [activeSessionId, sending, send, clearBranching]
  );

  const handleSelectTreeNode = useCallback(
    (nodeId: string) => {
      // The tree shows questions; jump to the answer so the full Q&A is read.
      const assistantChild = allMessages.find((m) => m.parentId === nodeId && m.role === 'assistant');
      setActiveNodeId(assistantChild?.id ?? nodeId);
      clearBranching();
    },
    [allMessages, clearBranching]
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
          } else {
            setActiveNodeId(msgs.length > 0 ? msgs[msgs.length - 1].id : null);
          }
        }
      } catch (err: any) {
        setError(err?.response?.data?.error ?? err?.message ?? 'Delete failed');
      }
    },
    [client, activeSessionId, activeNodeId, allMessages]
  );

  const handleNavigateToParent = useCallback(() => {
    if (!tree.siblingInfo?.parentId) return;
    setActiveNodeId(tree.siblingInfo.parentId);
    clearBranching();
  }, [tree, clearBranching]);

  const handleNavigateToSibling = useCallback(
    (offset: number) => {
      const info = tree.siblingInfo;
      if (!info) return;
      const newIndex = info.currentIndex + offset;
      if (newIndex < 0 || newIndex >= info.total) return;
      setActiveNodeId(info.siblings[newIndex].id);
      clearBranching();
    },
    [tree, clearBranching]
  );

  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      setActiveNodeId(nodeId);
      clearBranching();
    },
    [clearBranching]
  );

  const handleToggleIncognito = useCallback(async () => {
    if (!incognito) {
      prevSessionIdRef.current = activeSessionId;
      try {
        const session = await client.createSession();
        setIncognitoSessionId(session.id);
        setActiveSessionId(session.id);
        setAllMessages([]);
        setActiveNodeId(null);
        setIncognito(true);
      } catch (err) {
        console.error('Failed to start incognito session:', err);
      }
    } else {
      const id = incognitoSessionId;
      setIncognito(false);
      setIncognitoSessionId(null);
      setActiveSessionId(prevSessionIdRef.current);
      setAllMessages([]);
      setActiveNodeId(null);
      if (id) {
        client.deleteSession(id).catch(() => {});
      }
    }
  }, [incognito, incognitoSessionId, activeSessionId, client]);

  return {
    // data
    sessions: sessions.filter((s) => s.id !== incognitoSessionId),
    activeSessionId,
    allMessages,
    activeNodeId,
    threadPath: tree.threadPath,
    activePathIds: tree.activePathIds,
    nodes: tree.nodes,
    edges: tree.edges,
    siblingInfo: tree.siblingInfo,
    branchingFromMessageId,
    branchingFromPreview,
    branchingFromText,
    sending,
    error,
    availableProviders,
    selectedProvider,
    selectedModel,
    keyedProviders,
    incognito,
    // actions
    setProviderKey,
    clearProviderKey,
    handleImportConversations,
    handleTranscribeAudio,
    handleNewSession,
    handleSelectSession,
    handleRenameSession,
    handleDeleteSession,
    handleSendMessage,
    handleBranchFromMessage,
    handleSelectTreeNode,
    handleDeleteSubtree,
    handleNavigateToParent,
    handleNavigateToSibling,
    handleNavigateToNode,
    handleSelectModel,
    handleToggleIncognito
  };
}

export type UseTracebackReturn = ReturnType<typeof useTraceback>;
