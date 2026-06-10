// Importer for plain message-list JSON (the OpenAI-style format).
//
// Plain-English big picture:
// Lots of tools can produce a simple list of {role, content} messages -- the
// same shape every chat API speaks. This importer accepts either a single list
// or a bundle of named conversations, and turns each list into a straight
// chain (a tree with no forks, which is still a valid Traceback tree -- it
// grows branches the moment the user forks it here). This is the catch-all
// path for sources we have no dedicated parser for.

import type { ConversationImporter, ImportedConversation, ImportedMessage } from './types.js';

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

// Turn one flat message list into a chain. Hidden "system" turns are dropped;
// what remains links each message to the one before it.
function chainFromList(list: LooseMessage[], name: string | null): ImportedConversation | null {
  const messages: ImportedMessage[] = [];
  let prevId: string | null = null;
  let counter = 0;
  for (const m of list) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = String(m.content).trim();
    if (!content) continue;
    const id = `g${counter++}`;
    messages.push({ id, parentId: prevId, role: m.role, content });
    prevId = id;
  }
  if (messages.length === 0) return null;
  return { name, messages };
}

export const genericImporter: ConversationImporter = {
  id: 'generic',

  // Accepts: a bare [{role, content}, ...] list, or
  // { conversations: [{ name?, messages: [...] }, ...] }.
  detect(data: unknown): boolean {
    if (isMessageArray(data)) return true;
    if (data && typeof data === 'object' && Array.isArray((data as { conversations?: unknown }).conversations)) {
      const convs = (data as { conversations: LooseConversation[] }).conversations;
      return convs.length > 0 && convs.every((c) => isMessageArray(c?.messages));
    }
    return false;
  },

  parse(data: unknown): ImportedConversation[] {
    if (isMessageArray(data)) {
      const single = chainFromList(data, null);
      return single ? [single] : [];
    }
    const convs = (data as { conversations: LooseConversation[] }).conversations ?? [];
    const out: ImportedConversation[] = [];
    for (const c of convs) {
      const rawName = typeof c.name === 'string' ? c.name : typeof c.title === 'string' ? c.title : null;
      const parsed = chainFromList(c.messages ?? [], rawName?.trim() || null);
      if (parsed) out.push(parsed);
    }
    return out;
  }
};
