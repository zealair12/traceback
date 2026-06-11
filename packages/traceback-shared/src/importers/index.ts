// The importer registry and selector -- the import-side "switchboard".
//
// Plain-English: hand this module a parsed export file and it figures out which
// product the file came from, then translates it into Traceback's neutral
// conversation shape. Supporting a new product later means writing one parser
// file and adding one line to the list below, exactly like adding an LLM
// provider on the server.

import type { ConversationImporter, ImportedConversation } from './types.js';
import { chatgptImporter } from './chatgpt.js';
import { claudeCodeImporter } from './claudeCode.js';
import { claudeAiImporter } from './claudeAi.js';
import { geminiImporter } from './gemini.js';
import { genericImporter } from './generic.js';

// Order matters: more specific formats first, the catch-all last.
const importers: ConversationImporter[] = [
  chatgptImporter,
  claudeCodeImporter,
  claudeAiImporter,
  geminiImporter,
  genericImporter
];

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
      'Unrecognized file format. Supported: ChatGPT export (conversations.json), claude.ai export, Gemini Takeout JSON, Claude Code session (.jsonl), or a plain JSON list of {role, content} messages.'
    );
  }
  return { importerId: imp.id, conversations: imp.parse(data) };
}

// Same, but starting from the raw file text. Handles both regular JSON files
// and .jsonl files (one JSON record per line, like Claude Code sessions).
export function parseImportText(text: string): {
  importerId: string;
  conversations: ImportedConversation[];
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Not a single JSON document; try line-by-line (JSONL).
    const records: unknown[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        /* skip unparseable lines rather than fail the whole file */
      }
    }
    if (records.length === 0) {
      throw new Error(
        'That file is not valid JSON. For ChatGPT, unzip the export and drop conversations.json; for Claude Code, drop a session .jsonl file.'
      );
    }
    data = records;
  }
  return parseImportFile(data);
}

export { chatgptImporter, claudeCodeImporter, claudeAiImporter, geminiImporter, genericImporter };
export type { ConversationImporter, ImportedConversation, ImportedMessage } from './types.js';
export { conversationStats } from './types.js';
