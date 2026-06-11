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

export interface TracebackClient {
  readonly api: AxiosInstance;
  fetchSessions(): Promise<SessionResponse[]>;
  createSession(name?: string): Promise<SessionResponse>;
  updateSessionName(sessionId: string, name: string | null): Promise<SessionResponse>;
  fetchSessionMessages(sessionId: string): Promise<MessageResponse[]>;
  deleteSubtree(messageId: string): Promise<void>;
  /** Ask the server which LLM providers/models are available. */
  fetchProviders(): Promise<ProvidersResponse>;
  /** Write normalized conversations (from an importer) into the tree store. */
  importConversations(conversations: ImportedConversation[]): Promise<ImportResult>;
  /** Turn recorded audio (base64 data URL) into text via the server. */
  transcribeAudio(
    audioDataUrl: string,
    mediaType: string,
    options?: { apiKey?: string }
  ): Promise<{ text: string; provider: string; model: string }>;
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

    async importConversations(conversations: ImportedConversation[]) {
      const { data } = await api.post<ImportResult>('/import', { conversations });
      return data;
    },

    async transcribeAudio(audioDataUrl: string, mediaType: string, options?: { apiKey?: string }) {
      const { data } = await api.post<{ text: string; provider: string; model: string }>(
        '/transcribe',
        { audio: audioDataUrl, mediaType },
        // The user's key (if any) travels in a header, same as chat requests.
        options?.apiKey ? { headers: { 'x-provider-key': options.apiKey } } : undefined
      );
      return data;
    },

    async sendMessage(
      sessionId: string,
      content: string,
      parentId: string | null,
      options?: SendMessageOptions
    ) {
      const { data } = await api.post<SendMessageResult>(
        '/message/send',
        {
          session_id: sessionId,
          parent_id: parentId,
          content,
          // Only included when the caller chose a specific backend/model.
          provider: options?.provider,
          model: options?.model,
          attachments: options?.attachments
        },
        // The user's key (if any) goes in a header, not the body, so it never
        // lands in request logs that record bodies/URLs.
        options?.apiKey ? { headers: { 'x-provider-key': options.apiKey } } : undefined
      );
      return data;
    }
  };
}
