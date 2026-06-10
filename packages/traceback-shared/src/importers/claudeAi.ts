// Importer for claude.ai (web app) data exports.
//
// Plain-English big picture:
// claude.ai users can download their full history from Settings -> Privacy ->
// Export data; the zip contains a conversations.json. Each conversation there
// is a flat, time-ordered list of turns (chat_messages) marked "human" or
// "assistant" -- no branches, unlike ChatGPT's format. We import each one as a
// straight chain; it grows branches the moment the user forks it here.
//
// Built against the documented export shape; a real export file should be
// dropped in once available to confirm (the parser is tolerant of the known
// variations: text in content blocks vs a bare text field, optional model).

import type { ConversationImporter, ImportedConversation, ImportedMessage } from './types.js';

interface ClaudeAiMessage {
  uuid?: string;
  sender?: string;
  text?: string;
  content?: Array<{ type?: string; text?: string }>;
  created_at?: string;
}
interface ClaudeAiConversation {
  name?: string | null;
  model?: string;
  chat_messages?: ClaudeAiMessage[];
}

// Message text: prefer the content blocks, fall back to the bare text field.
function messageText(m: ClaudeAiMessage): string | null {
  if (Array.isArray(m.content)) {
    const joined = m.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  if (typeof m.text === 'string' && m.text.trim()) return m.text.trim();
  return null;
}

export const claudeAiImporter: ConversationImporter = {
  id: 'claude-ai',

  // A claude.ai export is an array of conversations, each carrying a
  // chat_messages list whose entries are marked with a sender.
  detect(data: unknown): boolean {
    return (
      Array.isArray(data) &&
      data.length > 0 &&
      data.every(
        (c) =>
          c &&
          typeof c === 'object' &&
          Array.isArray((c as ClaudeAiConversation).chat_messages) &&
          (c as ClaudeAiConversation).chat_messages!.every(
            (m) => m && typeof m === 'object' && typeof m.sender === 'string'
          )
      )
    );
  },

  parse(data: unknown): ImportedConversation[] {
    if (!this.detect(data)) return [];
    const out: ImportedConversation[] = [];
    for (const conv of data as ClaudeAiConversation[]) {
      const model = typeof conv.model === 'string' && conv.model.trim() ? conv.model : null;
      const messages: ImportedMessage[] = [];
      let prevId: string | null = null;
      let counter = 0;
      for (const m of conv.chat_messages ?? []) {
        const role = m.sender === 'human' ? 'user' : m.sender === 'assistant' ? 'assistant' : null;
        const text = messageText(m);
        if (!role || !text) continue;
        const id = typeof m.uuid === 'string' && m.uuid ? m.uuid : `c${counter}`;
        counter += 1;
        messages.push({
          id,
          parentId: prevId,
          role,
          content: text,
          createdAt: typeof m.created_at === 'string' ? m.created_at : undefined,
          provider: role === 'assistant' && model ? 'anthropic' : null,
          model: role === 'assistant' ? model : null
        });
        prevId = id;
      }
      if (messages.length > 0) {
        out.push({ name: conv.name?.trim() || null, messages });
      }
    }
    return out;
  }
};
