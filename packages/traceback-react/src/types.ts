// UI-facing types for the Traceback chat components.

// One message as shown in the chat thread. This is a trimmed view of the
// server's message: just what the bubbles need to render, plus which model
// produced an assistant reply (so we can show the "answered by" badge).
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string | null;
  model?: string | null;
}
