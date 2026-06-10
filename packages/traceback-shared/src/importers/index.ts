// The importer registry and selector -- the import-side "switchboard".
//
// Plain-English: hand this module a parsed export file and it figures out which
// product the file came from, then translates it into Traceback's neutral
// conversation shape. Supporting a new product later means writing one parser
// file and adding one line to the list below, exactly like adding an LLM
// provider on the server.

import type { ConversationImporter, ImportedConversation } from './types.js';
import { chatgptImporter } from './chatgpt.js';
import { genericImporter } from './generic.js';

// Order matters: more specific formats first, the catch-all last.
const importers: ConversationImporter[] = [chatgptImporter, genericImporter];

// Which importer (if any) understands this parsed JSON?
export function detectImporter(data: unknown): ConversationImporter | null {
  for (const imp of importers) {
    if (imp.detect(data)) return imp;
  }
  return null;
}

// Translate parsed JSON into normalized conversations, or throw a clear,
// user-showable error when no importer recognizes the format.
export function parseImportFile(data: unknown): {
  importerId: string;
  conversations: ImportedConversation[];
} {
  const imp = detectImporter(data);
  if (!imp) {
    throw new Error(
      'Unrecognized file format. Supported: a ChatGPT data export (conversations.json) or a plain JSON list of {role, content} messages.'
    );
  }
  return { importerId: imp.id, conversations: imp.parse(data) };
}

export { chatgptImporter, genericImporter };
export type { ConversationImporter, ImportedConversation, ImportedMessage } from './types.js';
export { conversationStats } from './types.js';
