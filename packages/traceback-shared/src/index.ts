import axios, { type AxiosInstance } from 'axios';
import type { ImportedConversation } from './importers/index.js';

/** Traceback HTTP API — same routes as `traceback/server` (sessions + branching messages). */

// Conversation importers (ChatGPT export, generic message lists) and the
// neutral conversation shape they produce.
export {
  parseImportFile,
  parseImportText,
  detectImporter,
  conversationStats,
  chatgptImporter,
  claudeCodeImporter,
  claudeAiImporter,
  geminiImporter,
  genericImporter
} from './importers/index.js';
export type {
  ConversationImporter,
  ImportedConversation,
  ImportedMessage
} from './importers/index.js';

export interface SessionResponse {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One thing attached to a message: an image or a document (PDF), carried as a
 * base64 data URL. The name is shown for documents. (The type is named for
 * its original image-only days; it now covers files too.)
 */
export interface ImageAttachment {
  type: 'image' | 'file';
  mediaType: string;
  dataUrl: string;
  name?: string;
}
export type Attachment = ImageAttachment;

export interface MessageResponse {
  id: string;
  sessionId: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  depth: number;
  branchLabel: string | null;
  // Images attached to this message, when any.
  attachments?: ImageAttachment[] | null;
  // Which backend/model produced this message (assistant messages only).
  // Null/absent for user messages and pre-existing rows.
  provider?: string | null;
  model?: string | null;
  createdAt: string;
}

/** One LLM backend the server can talk to, as advertised to a frontend. */
export interface ProviderInfo {
  id: string;
  defaultModel: string;
  suggestedModels: string[];
  // Which of this backend's models accept images (used by Auto routing).
  visionModels: string[];
  // Which of this backend's models accept document (PDF) attachments.
  documentModels: string[];
  configured: boolean;
}

/** Response of GET /providers: the default backend and the full list. */
export interface ProvidersResponse {
  default: string;
  providers: ProviderInfo[];
}

/** Response of GET /auth/me. */
export type AuthMeResponse =
  | { isGuest: false; id: string; name: string | null; email: string; avatar: string | null }
  | { isGuest: true; dailyLimit: number; messagesUsedToday: number };

/** Optional per-message choice of which backend and model should answer. */
export interface SendMessageOptions {
  provider?: string;
  model?: string;
  // Images to attach to this message (base64 data URLs, max 4).
  attachments?: ImageAttachment[];
  // Optional "bring your own key": the user's API key for this request. Sent in
  // a header (never the URL or body), used by the server for this request only,
  // and never stored or logged.
  apiKey?: string;
}

export interface SendMessageResult {
  userMessage: MessageResponse;
  assistantMessage: MessageResponse;
  lineage: Array<{
    id: string;
    session_id: string;
    parent_id: string | null;
    role: 'user' | 'assistant' | 'system';
    content: string;
    depth: number;
    branch_label: string | null;
    created_at: string;
  }>;
}

/** Result of importing conversations: one entry per created session. */
export interface ImportResult {
  imported: Array<{ sessionId: string; name: string | null; messageCount: number }>;
}

/** Result of an agent run: the task node, the step nodes, and the final answer. */
export interface AgentRunResult {
  sessionId: string;
  taskMessage: MessageResponse;
  steps: MessageResponse[];
  answer: string;
}

/**
 * The Traceback HTTP client: one object holding every call the server
 * understands. A class so embedders can extend or wrap it; the
 * createTracebackClient factory below is the conventional way to make one.
 */
// Parse one Server-Sent-Events block ("event: X\ndata: {json}") into its parts.
// Exported so it can be unit-tested without a live stream.
export function parseSSEBlock(block: string): { event: string; data: any } | null {
  const event = /^event: (.*)$/m.exec(block)?.[1];
  const data = /^data: (.*)$/m.exec(block)?.[1];
  if (!event || data === undefined) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

export class TracebackClient {
  readonly api: AxiosInstance;
  // Stored for the streaming endpoint, which uses fetch (axios can't stream a
  // response body in the browser).
  private readonly baseURL: string;

  constructor(baseURL: string, options?: { axiosInstance?: AxiosInstance }) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.api =
      options?.axiosInstance ??
      axios.create({ baseURL: this.baseURL, withCredentials: true });
  }

  // The user's key (if any) travels in a header -- never the URL or body --
  // so it cannot land in request logs.
  private auth(apiKey?: string) {
    return apiKey ? { headers: { 'x-provider-key': apiKey } } : undefined;
  }

  async fetchSessions(): Promise<SessionResponse[]> {
    const { data } = await this.api.get<SessionResponse[]>('/sessions');
    return data;
  }

  async createSession(name?: string): Promise<SessionResponse> {
    const { data } = await this.api.post<SessionResponse>('/sessions', { name });
    return data;
  }

  async updateSessionName(sessionId: string, name: string | null): Promise<SessionResponse> {
    const { data } = await this.api.patch<SessionResponse>(`/sessions/${sessionId}`, { name });
    return data;
  }

  // Ask the server to title an untitled chat from its first message (LLM-based).
  // No-op server-side if the chat already has a name.
  async autoNameSession(sessionId: string): Promise<SessionResponse> {
    const { data } = await this.api.post<SessionResponse>(`/sessions/${sessionId}/autoname`, {});
    return data;
  }

  // Run agent mode: the model works the task step by step (search, reason,
  // answer), persisting the task and each step into the session's tree.
  async runAgent(sessionId: string, parentId: string | null, task: string): Promise<AgentRunResult> {
    const { data } = await this.api.post<AgentRunResult>('/agent/run', {
      session_id: sessionId,
      parent_id: parentId,
      task
    });
    return data;
  }

  // Run agent mode and stream each step live. onStep fires per step (tool call,
  // result, final answer); onDone fires once with the persisted trace. Falls
  // back to runAgent at the call site if the stream fails before any step.
  async runAgentStream(
    sessionId: string,
    parentId: string | null,
    task: string,
    handlers: {
      onStep: (step: { type: string; tool?: string; content: string }) => void;
      onToken: (chunk: string) => void;
      onDone: (result: AgentRunResult) => void;
    }
  ): Promise<void> {
    const res = await fetch(`${this.baseURL}/agent/stream`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, parent_id: parentId, task })
    });
    if (!res.ok) {
      let body: { error?: string; guestLimitReached?: boolean } = {};
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      const err = new Error(body.error ?? 'Agent request failed') as Error & { response?: unknown };
      err.response = { data: body, status: res.status };
      throw err;
    }
    if (!res.body) throw new Error('Streaming is not supported here.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const evt = parseSSEBlock(block);
        if (!evt) continue;
        if (evt.event === 'step') handlers.onStep(evt.data);
        else if (evt.event === 'token') handlers.onToken(evt.data.chunk as string);
        else if (evt.event === 'done') handlers.onDone(evt.data);
        else if (evt.event === 'error') throw new Error((evt.data.error as string) ?? 'Agent error');
      }
    }
  }

  // Send a message and stream the reply. onToken fires per chunk; onDone fires
  // once with the stored messages. Uses fetch because axios can't read a
  // streaming body in the browser. Throws on a non-2xx (e.g. guest limit), with
  // the JSON error attached as `.response.data` so callers can branch on it.
  async sendMessageStream(
    sessionId: string,
    content: string,
    parentId: string | null,
    opts: { provider?: string; model?: string; attachments?: ImageAttachment[]; apiKey?: string },
    handlers: {
      onToken: (chunk: string) => void;
      onDone: (result: { userMessage: MessageResponse; assistantMessage: MessageResponse }) => void;
    }
  ): Promise<void> {
    const res = await fetch(`${this.baseURL}/message/stream`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(opts.apiKey ? { 'x-provider-key': opts.apiKey } : {}) },
      body: JSON.stringify({
        session_id: sessionId,
        parent_id: parentId,
        content,
        provider: opts.provider,
        model: opts.model,
        attachments: opts.attachments
      })
    });
    if (!res.ok) {
      let body: { error?: string; guestLimitReached?: boolean } = {};
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      const err = new Error(body.error ?? 'Stream request failed') as Error & { response?: unknown };
      err.response = { data: body, status: res.status };
      throw err;
    }
    if (!res.body) throw new Error('Streaming is not supported here.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const evt = parseSSEBlock(block);
        if (!evt) continue;
        if (evt.event === 'token') handlers.onToken(evt.data.chunk as string);
        else if (evt.event === 'done') handlers.onDone(evt.data);
        else if (evt.event === 'error') throw new Error((evt.data.error as string) ?? 'Stream error');
      }
    }
  }

  async fetchSessionMessages(sessionId: string): Promise<MessageResponse[]> {
    const { data } = await this.api.get<MessageResponse[]>(`/sessions/${sessionId}/messages`);
    return data;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.api.delete(`/sessions/${sessionId}`);
  }

  async deleteSubtree(messageId: string): Promise<void> {
    await this.api.delete(`/messages/${messageId}`);
  }

  /** Ask the server which LLM providers/models are available. */
  async fetchProviders(): Promise<ProvidersResponse> {
    const { data } = await this.api.get<ProvidersResponse>('/providers');
    return data;
  }

  async fetchCurrentUser(): Promise<AuthMeResponse> {
    const { data } = await this.api.get<AuthMeResponse>('/auth/me');
    return data;
  }

  async signOut(): Promise<void> {
    await this.api.post('/auth/logout');
  }

  signIn(): void {
    const base = String(this.api.defaults.baseURL ?? '');
    window.location.href = `${base}/auth/google`;
  }

  /** Write normalized conversations (from an importer) into the tree store. */
  async importConversations(conversations: ImportedConversation[]): Promise<ImportResult> {
    const { data } = await this.api.post<ImportResult>('/import', { conversations });
    return data;
  }

  /** Turn recorded audio (base64 data URL) into text via the server. */
  async transcribeAudio(
    audioDataUrl: string,
    mediaType: string,
    options?: { apiKey?: string }
  ): Promise<{ text: string; provider: string; model: string }> {
    const { data } = await this.api.post<{ text: string; provider: string; model: string }>(
      '/transcribe',
      { audio: audioDataUrl, mediaType },
      this.auth(options?.apiKey)
    );
    return data;
  }

  async sendMessage(
    sessionId: string,
    content: string,
    parentId: string | null,
    // Optional: pick which backend/model answers this specific message.
    options?: SendMessageOptions
  ): Promise<SendMessageResult> {
    const { data } = await this.api.post<SendMessageResult>(
      '/message/send',
      {
        session_id: sessionId,
        parent_id: parentId,
        content,
        provider: options?.provider,
        model: options?.model,
        attachments: options?.attachments
      },
      this.auth(options?.apiKey)
    );
    return data;
  }
}

export function createTracebackClient(
  baseURL: string,
  options?: { axiosInstance?: AxiosInstance }
): TracebackClient {
  return new TracebackClient(baseURL, options);
}
