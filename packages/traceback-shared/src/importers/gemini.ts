// Importer for Gemini history from Google Takeout.
//
// Plain-English big picture:
// Gemini conversations export through Google Takeout (choose "My Activity" ->
// "Gemini Apps" -- picking the "Gemini" product itself only exports Gems
// configuration, not chats). The JSON contains turns marked "user" or "model"
// with text and a timestamp. Takeout's exact wrapping has varied over time --
// sometimes one file with a conversations array, sometimes one file per
// conversation, occasionally a bare list of turns -- so this parser accepts
// the known JSON shapes. Conversations are linear and import as chains.
//
// Built against documented shapes; drop in a real Takeout file to confirm.

import type { ConversationImporter, ImportedConversation, ImportedMessage } from './types.js';

interface GeminiTurn {
  role?: string;
  text?: string;
  create_time?: string | number;
}
interface GeminiConversation {
  title?: string;
  name?: string;
  messages?: GeminiTurn[];
}

function isTurn(v: unknown): v is GeminiTurn {
  return (
    !!v &&
    typeof v === 'object' &&
    ((v as GeminiTurn).role === 'user' || (v as GeminiTurn).role === 'model') &&
    typeof (v as GeminiTurn).text === 'string'
  );
}
function isTurnArray(v: unknown): v is GeminiTurn[] {
  return Array.isArray(v) && v.length > 0 && v.every(isTurn);
}

// Takeout timestamps appear as ISO strings or unix epochs (seconds or ms).
function toIso(t: string | number | undefined): string | undefined {
  if (typeof t === 'string') return t;
  if (typeof t === 'number') {
    const ms = t > 1e12 ? t : t * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

function chainFromTurns(turns: GeminiTurn[], name: string | null): ImportedConversation | null {
  const messages: ImportedMessage[] = [];
  let prevId: string | null = null;
  let counter = 0;
  for (const t of turns) {
    const text = (t.text ?? '').trim();
    if (!text) continue;
    const id = `g${counter++}`;
    const role = t.role === 'user' ? 'user' : 'assistant'; // "model" -> assistant
    messages.push({
      id,
      parentId: prevId,
      role,
      content: text,
      createdAt: toIso(t.create_time),
      provider: role === 'assistant' ? 'google' : null,
      model: null // Takeout does not record which Gemini model answered
    });
    prevId = id;
  }
  if (messages.length === 0) return null;
  return { name, messages };
}

export const geminiImporter: ConversationImporter = {
  id: 'gemini',

  // Accepts: a bare list of user/model turns, or
  // { conversations: [{ title?, messages: [turns] }, ...] }.
  detect(data: unknown): boolean {
    if (isTurnArray(data)) return true;
    if (data && typeof data === 'object') {
      const convs = (data as { conversations?: unknown }).conversations;
      return (
        Array.isArray(convs) &&
        convs.length > 0 &&
        convs.every((c) => c && typeof c === 'object' && isTurnArray((c as GeminiConversation).messages))
      );
    }
    return false;
  },

  parse(data: unknown): ImportedConversation[] {
    if (isTurnArray(data)) {
      const single = chainFromTurns(data, null);
      return single ? [single] : [];
    }
    const convs = ((data as { conversations?: GeminiConversation[] }).conversations ?? []);
    const out: ImportedConversation[] = [];
    for (const c of convs) {
      const rawName = typeof c.title === 'string' ? c.title : typeof c.name === 'string' ? c.name : null;
      const parsed = chainFromTurns(c.messages ?? [], rawName?.trim() || null);
      if (parsed) out.push(parsed);
    }
    return out;
  }
};
