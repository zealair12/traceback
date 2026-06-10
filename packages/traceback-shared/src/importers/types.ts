// The "contract" every conversation importer must fulfil.
//
// Plain-English big picture:
// Users can download their chat history from other products (ChatGPT, Claude,
// and friends) as a file. Each product uses a different file format, so each
// format gets one small "importer" plugin that translates it into ONE neutral
// shape -- the normalized conversation below. Everything downstream (the
// preview panel, the server's import endpoint, the tree engine) only ever sees
// the neutral shape, so adding support for a new product is just one new
// parser file. This mirrors how LLM providers are pluggable on the server.

// One message in a normalized, ready-to-import conversation.
export interface ImportedMessage {
  // The id the message had in the source file. Only used to express the
  // parent/child structure; the server assigns fresh ids on import.
  id: string;
  // The id of the message this one replies to, or null for a conversation root.
  // Guaranteed to reference a message that appears EARLIER in the array.
  parentId: string | null;
  role: 'user' | 'assistant';
  content: string;
  // Original timestamp (ISO string), kept so imported history sorts correctly.
  createdAt?: string;
  // Which backend/model originally produced this message, when the source file
  // records it (e.g. provider "openai", model "gpt-4o"). Shown as the same
  // "answered by" badge native messages get.
  provider?: string | null;
  model?: string | null;
}

// One conversation translated into Traceback's neutral shape. The messages
// array is in parents-before-children order, so it can be written to the
// database in a single forward pass.
export interface ImportedConversation {
  name: string | null;
  messages: ImportedMessage[];
}

// The plugin contract: recognize a file's parsed JSON, and translate it.
export interface ConversationImporter {
  // Short id, e.g. "chatgpt" or "generic".
  id: string;
  // Does this parsed JSON look like this importer's format?
  detect(data: unknown): boolean;
  // Translate the parsed JSON into normalized conversations.
  parse(data: unknown): ImportedConversation[];
}

// Quick numbers for the preview list ("214 conversations, 37 with branches").
export function conversationStats(conv: ImportedConversation): {
  messageCount: number;
  branchCount: number;
} {
  const childCounts = new Map<string, number>();
  for (const m of conv.messages) {
    if (m.parentId) childCounts.set(m.parentId, (childCounts.get(m.parentId) ?? 0) + 1);
  }
  let branchCount = 0;
  for (const n of childCounts.values()) if (n > 1) branchCount += 1;
  return { messageCount: conv.messages.length, branchCount };
}
