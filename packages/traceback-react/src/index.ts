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
// The framework-free engine pieces, for embedders who skip React entirely:
// the tree math, the Auto-routing rules, and the browser key store.
export { ConversationTree } from './lib/conversationTree.js';
export type { SiblingInfo } from './lib/conversationTree.js';
export { ModelRouter } from './lib/modelRouter.js';
export { KeyStore, keyStore } from './lib/keyStore.js';
// The chat-history import panel, reusable by headless integrations.
export { ImportPanel } from './components/ImportPanel.js';
// The Traceback mark (branching-tree glyph), for embedders to reuse.
export { BrandIcon } from './components/BrandIcon.js';
// Landing-page proof of concept: the real app on a scroll-driven laptop, fed by
// a scripted no-network client. Also the reference for injecting a custom client.
export { LaptopDemo } from './demo/LaptopDemo.js';
export { MockTracebackClient } from './demo/mockClient.js';

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
