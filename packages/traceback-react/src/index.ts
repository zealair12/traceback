// Public entry point for @traceback/react.
//
// Two ways to use this package:
// 1. Standard UI: render <TracebackChat apiUrl="http://your-server" /> and get
//    the full sidebar + chat + branching-tree experience.
// 2. Headless: call useTraceback({ apiUrl }) and build your own UI around the
//    returned state and actions.

export { TracebackChat } from './TracebackChat.js';
export type { TracebackChatProps } from './TracebackChat.js';
export { useTraceback } from './useTraceback.js';
export type { UseTracebackOptions, UseTracebackReturn } from './useTraceback.js';
export type { ChatMessage } from './types.js';
// The "bring your own key" panel, reusable by headless integrations.
export { KeyManager } from './components/KeyManager.js';
export { getStoredKey, setStoredKey, clearStoredKey } from './keys.js';
// The chat-history import panel, reusable by headless integrations.
export { ImportPanel } from './components/ImportPanel.js';

// Re-export the HTTP client + types so headless users have everything from one
// import.
export {
  createTracebackClient,
  type TracebackClient,
  type SessionResponse,
  type MessageResponse,
  type SendMessageResult,
  type ProviderInfo,
  type ProvidersResponse
} from '@traceback/shared';
