// Importer for plain message-list JSON (the OpenAI-style format).
//
// Plain-English big picture:
// Lots of tools can produce a simple list of {role, content} messages -- the
// same shape every chat API speaks. This catch-all importer accepts either a
// single list or a bundle of named conversations, and each list imports as a
// chain. Hidden "system" turns are dropped.

import type { ImportedConversation } from './types.js';
import { BaseImporter, type ChainTurn } from './base.js';

interface LooseMessage {
  role?: string;
  content?: unknown;
}
interface LooseConversation {
  name?: unknown;
  title?: unknown;
  messages?: LooseMessage[];
}

function isMessageArray(v: unknown): v is LooseMessage[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (m) =>
        m &&
        typeof m === 'object' &&
        typeof (m as LooseMessage).role === 'string' &&
        typeof (m as LooseMessage).content === 'string'
    )
  );
}

export class GenericImporter extends BaseImporter {
  readonly id = 'generic';

  // Accepts: a bare [{role, content}, ...] list, or
  // { conversations: [{ name?, messages: [...] }, ...] }.
  detect(data: unknown): boolean {
    if (isMessageArray(data)) return true;
    if (data && typeof data === 'object' && Array.isArray((data as { conversations?: unknown }).conversations)) {
      const convs = (data as { conversations: LooseConversation[] }).conversations;
      return convs.length > 0 && convs.every((c) => isMessageArray(c?.messages));
    }
    return false;
  }

  parse(data: unknown): ImportedConversation[] {
    const toTurns = (list: LooseMessage[]): ChainTurn[] =>
      list
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content) }));

    if (isMessageArray(data)) {
      const single = this.chain(toTurns(data), null);
      return single ? [single] : [];
    }
    const convs = (data as { conversations: LooseConversation[] }).conversations ?? [];
    const out: ImportedConversation[] = [];
    for (const c of convs) {
      const rawName = typeof c.name === 'string' ? c.name : typeof c.title === 'string' ? c.title : null;
      const parsed = this.chain(toTurns(c.messages ?? []), rawName?.trim() || null);
      if (parsed) out.push(parsed);
    }
    return out;
  }
}

export const genericImporter = new GenericImporter();
