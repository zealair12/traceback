// Importer for Gemini history from Google Takeout.
//
// Plain-English big picture:
// Gemini conversations export through Google Takeout (choose "My Activity" ->
// "Gemini Apps" -- picking the "Gemini" product itself only exports Gems
// configuration, not chats). The JSON contains turns marked "user" or "model"
// with text and a timestamp. Takeout's wrapping has varied over time, so this
// importer accepts the known shapes: a conversations array, or a bare list of
// turns. Conversations are linear and import as chains.
//
// Built against documented shapes; drop in a real Takeout file to confirm.

import type { ImportedConversation } from './types.js';
import { BaseImporter, type ChainTurn } from './base.js';

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
    const d = new Date(t > 1e12 ? t : t * 1000);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

export class GeminiImporter extends BaseImporter {
  readonly id = 'gemini';

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
  }

  parse(data: unknown): ImportedConversation[] {
    const toTurns = (list: GeminiTurn[]): ChainTurn[] =>
      list.map((t) => ({
        role: t.role === 'user' ? 'user' : 'assistant', // "model" -> assistant
        content: t.text ?? '',
        createdAt: toIso(t.create_time),
        // Takeout does not record which Gemini model answered, so no model badge.
        provider: t.role === 'model' ? 'google' : null
      }));

    if (isTurnArray(data)) {
      const single = this.chain(toTurns(data), null);
      return single ? [single] : [];
    }
    const convs = (data as { conversations?: GeminiConversation[] }).conversations ?? [];
    const out: ImportedConversation[] = [];
    for (const c of convs) {
      const rawName = typeof c.title === 'string' ? c.title : typeof c.name === 'string' ? c.name : null;
      const parsed = this.chain(toTurns(c.messages ?? []), rawName?.trim() || null);
      if (parsed) out.push(parsed);
    }
    return out;
  }
}

export const geminiImporter = new GeminiImporter();
