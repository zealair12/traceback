// Shared TypeScript types for the TraceBack frontend.
// These mirror the core concepts from the backend but are
// intentionally minimal and UI-focused.

export type Role = 'user' | 'assistant' | 'system';

export interface Session {
  id: string;
  title: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
}

// Lightweight representation of a node in the conversation tree
// for React Flow. We keep this separate from backend `Message`
// so layout metadata (position, active state, etc.) lives purely
// on the client.
export interface TreeNodeData {
  id: string;
  label: string;
  isActive?: boolean;
}

