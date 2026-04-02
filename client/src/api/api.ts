import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false
});

// --- Session API ---

export interface SessionResponse {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSessions(): Promise<SessionResponse[]> {
  const { data } = await api.get<SessionResponse[]>('/sessions');
  return data;
}

export async function createSession(name?: string): Promise<SessionResponse> {
  const { data } = await api.post<SessionResponse>('/sessions', { name });
  return data;
}

export async function updateSessionName(
  sessionId: string,
  name: string | null
): Promise<SessionResponse> {
  const { data } = await api.patch<SessionResponse>(`/sessions/${sessionId}`, { name });
  return data;
}

// --- Message API ---

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

export async function fetchSessionMessages(sessionId: string): Promise<MessageResponse[]> {
  const { data } = await api.get<MessageResponse[]>(`/sessions/${sessionId}/messages`);
  return data;
}

export async function deleteSubtree(messageId: string): Promise<void> {
  await api.delete(`/messages/${messageId}`);
}

export async function sendMessage(
  sessionId: string,
  content: string,
  parentId: string | null
): Promise<SendMessageResult> {
  const { data } = await api.post<SendMessageResult>('/message/send', {
    session_id: sessionId,
    parent_id: parentId,
    content
  });
  return data;
}
