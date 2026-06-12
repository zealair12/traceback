// Importer for claude.ai (web app) data exports.
//
// Plain-English big picture:
// claude.ai users download their history from Settings -> Privacy -> Export
// data; the zip contains a conversations.json. Each conversation is a flat,
// time-ordered list of turns marked "human" or "assistant" -- no branches --
// so each one imports as a chain. The conversation's recorded model is kept
// on assistant replies for the "answered by" badge.
//
// Built against the documented export shape (tolerant of the known
// variations: text in content blocks vs a bare text field, optional model).

import type { ImportedConversation } from './types.js';
import { BaseImporter, type ChainTurn } from './base.js';

interface ClaudeAiMessage {
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
function messageText(m: ClaudeAiMessage): string {
  if (Array.isArray(m.content)) {
    const joined = m.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  return typeof m.text === 'string' ? m.text : '';
}

export class ClaudeAiImporter extends BaseImporter {
  readonly id = 'claude-ai';

  // An array of conversations, each carrying sender-marked chat_messages.
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
  }

  parse(data: unknown): ImportedConversation[] {
    if (!this.detect(data)) return [];
    const out: ImportedConversation[] = [];
    for (const conv of data as ClaudeAiConversation[]) {
      const model = typeof conv.model === 'string' && conv.model.trim() ? conv.model : null;
      const turns: ChainTurn[] = (conv.chat_messages ?? [])
        .filter((m) => m.sender === 'human' || m.sender === 'assistant')
        .map((m) => ({
          role: m.sender === 'human' ? 'user' : 'assistant',
          content: messageText(m),
          createdAt: typeof m.created_at === 'string' ? m.created_at : undefined,
          provider: m.sender === 'assistant' && model ? 'anthropic' : null,
          model: m.sender === 'assistant' ? model : null
        }));
      const parsed = this.chain(turns, conv.name?.trim() || null);
      if (parsed) out.push(parsed);
    }
    return out;
  }
}

export const claudeAiImporter = new ClaudeAiImporter();
