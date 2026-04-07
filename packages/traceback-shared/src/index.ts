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
  createdAt: string;
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
  sendMessage(
    sessionId: string,
    content: string,
    parentId: string | null
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

    async sendMessage(sessionId: string, content: string, parentId: string | null) {
      const { data } = await api.post<SendMessageResult>('/message/send', {
        session_id: sessionId,
        parent_id: parentId,
        content
      });
      return data;
    }
  };
}
