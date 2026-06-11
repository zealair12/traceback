// The shared backbone every conversation importer inherits.
//
// Plain-English big picture:
// Most chat exports are flat, time-ordered lists of turns; only ChatGPT (and
// Claude Code) store real trees. This base class owns the one routine the
// flat-format importers were each repeating: turn a list of turns into a
// parent-linked chain (a tree with no forks). A concrete importer only
// recognizes its file format and maps it to turns.

import type { ConversationImporter, ImportedConversation, ImportedMessage } from './types.js';

// One turn of a flat conversation, before it becomes a chain.
export interface ChainTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  provider?: string | null;
  model?: string | null;
}

export abstract class BaseImporter implements ConversationImporter {
  abstract readonly id: string;
  abstract detect(data: unknown): boolean;
  abstract parse(data: unknown): ImportedConversation[];

  // Build a chain: each surviving turn's parent is the turn before it.
  // Returns null when nothing survives (e.g. all turns were empty).
  protected chain(turns: ChainTurn[], name: string | null): ImportedConversation | null {
    const messages: ImportedMessage[] = [];
    let prevId: string | null = null;
    let counter = 0;
    for (const t of turns) {
      const content = t.content.trim();
      if (!content) continue;
      const id = `m${counter++}`;
      messages.push({
        id,
        parentId: prevId,
        role: t.role,
        content,
        createdAt: t.createdAt,
        provider: t.provider ?? null,
        model: t.model ?? null
      });
      prevId = id;
    }
    return messages.length > 0 ? { name, messages } : null;
  }
}
