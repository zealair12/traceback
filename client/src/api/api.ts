import { createTracebackClient } from '@traceback/shared';
import type {
  MessageResponse,
  SendMessageResult,
  SessionResponse,
  ProviderInfo,
  ProvidersResponse
} from '@traceback/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

const client = createTracebackClient(API_BASE);

export const api = client.api;

export type { MessageResponse, SendMessageResult, SessionResponse, ProviderInfo, ProvidersResponse };

export const fetchSessions = client.fetchSessions.bind(client);
export const createSession = client.createSession.bind(client);
export const updateSessionName = client.updateSessionName.bind(client);
export const fetchSessionMessages = client.fetchSessionMessages.bind(client);
export const deleteSubtree = client.deleteSubtree.bind(client);
export const sendMessage = client.sendMessage.bind(client);
// Ask the server which LLM backends/models are available (for the picker).
export const fetchProviders = client.fetchProviders.bind(client);
