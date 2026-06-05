import axios, { type AxiosInstance } from 'axios';

/** Traceback HTTP API — same routes as `traceback/server` (sessions + branching messages). */

export interface SessionResponse {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageResponse {
  id: string;
  sessionId: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  depth: number;
  branchLabel: string | null;
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
  configured: boolean;
}

/** Response of GET /providers: the default backend and the full list. */
export interface ProvidersResponse {
  default: string;
  providers: ProviderInfo[];
}

/** Optional per-message choice of which backend and model should answer. */
export interface SendMessageOptions {
  provider?: string;
  model?: string;
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

export interface TracebackClient {
  readonly api: AxiosInstance;
  fetchSessions(): Promise<SessionResponse[]>;
  createSession(name?: string): Promise<SessionResponse>;
  updateSessionName(sessionId: string, name: string | null): Promise<SessionResponse>;
  fetchSessionMessages(sessionId: string): Promise<MessageResponse[]>;
  deleteSubtree(messageId: string): Promise<void>;
  /** Ask the server which LLM providers/models are available. */
  fetchProviders(): Promise<ProvidersResponse>;
  sendMessage(
    sessionId: string,
    content: string,
    parentId: string | null,
    // Optional: pick which backend/model answers this specific message.
    options?: SendMessageOptions
  ): Promise<SendMessageResult>;
}

export function createTracebackClient(
  baseURL: string,
  options?: { axiosInstance?: AxiosInstance }
): TracebackClient {
  const api =
    options?.axiosInstance ??
    axios.create({
      baseURL: baseURL.replace(/\/$/, ''),
      withCredentials: false
    });

  return {
    api,

    async fetchSessions() {
      const { data } = await api.get<SessionResponse[]>('/sessions');
      return data;
    },

    async createSession(name?: string) {
      const { data } = await api.post<SessionResponse>('/sessions', { name });
      return data;
    },

    async updateSessionName(sessionId: string, name: string | null) {
      const { data } = await api.patch<SessionResponse>(`/sessions/${sessionId}`, { name });
      return data;
    },

    async fetchSessionMessages(sessionId: string) {
      const { data } = await api.get<MessageResponse[]>(`/sessions/${sessionId}/messages`);
      return data;
    },

    async deleteSubtree(messageId: string) {
      await api.delete(`/messages/${messageId}`);
    },

    async fetchProviders() {
      const { data } = await api.get<ProvidersResponse>('/providers');
      return data;
    },

    async sendMessage(
      sessionId: string,
      content: string,
      parentId: string | null,
      options?: SendMessageOptions
    ) {
      const { data } = await api.post<SendMessageResult>('/message/send', {
        session_id: sessionId,
        parent_id: parentId,
        content,
        // Only included when the caller chose a specific backend/model.
        provider: options?.provider,
        model: options?.model
      });
      return data;
    }
  };
}
