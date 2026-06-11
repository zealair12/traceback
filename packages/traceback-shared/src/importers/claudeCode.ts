// Importer for Claude Code session files (.jsonl transcripts).
//
// Plain-English big picture:
// Claude Code (the coding assistant CLI/app) stores every session on the
// user's own machine as a .jsonl file -- one JSON record per line -- under
// ~/.claude/projects/. Unlike ChatGPT there is nothing to wait for: the
// history is already local. Each record carries its own id and its parent's
// id, so a session is a tree just like ours. This parser keeps the
// human-visible turns (the user's prompts and the assistant's text replies),
// skips the machinery (thinking, tool calls and results, queue bookkeeping),
// and stitches consecutive assistant text segments into single replies.

import type { ConversationImporter, ImportedConversation, ImportedMessage } from './types.js';

interface ClaudeCodeRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  timestamp?: string;
  aiTitle?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
  };
}

// Human text from a user record, or null if it is plumbing (tool results,
// slash-command wrappers, caveat notes injected by the harness).
function userText(content: unknown): string | null {
  let text: string | null = null;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts = content
      .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text);
    text = parts.length ? parts.join('\n') : null;
  }
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^<(command-name|command-message|local-command-stdout)/.test(trimmed)) return null;
  if (trimmed.startsWith('Caveat:')) return null;
  return trimmed;
}

// Visible text from an assistant record (its text blocks only), or null.
function assistantText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text);
  const joined = parts.join('\n').trim();
  return joined || null;
}

export const claudeCodeImporter: ConversationImporter = {
  id: 'claude-code',

  // A parsed Claude Code session is an array of line-records where the
  // conversational ones carry uuid/parentUuid and a type of user/assistant.
  detect(data: unknown): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    const convo = (data as ClaudeCodeRecord[]).filter(
      (r) => r && (r.type === 'user' || r.type === 'assistant')
    );
    return convo.length > 0 && convo.every((r) => typeof r.uuid === 'string' && 'parentUuid' in r);
  },

  parse(data: unknown): ImportedConversation[] {
    if (!this.detect(data)) return [];
    const records = (data as ClaudeCodeRecord[]).filter((r) => r && !r.isSidechain);

    // The session title is updated as the conversation evolves; use the last.
    let name: string | null = null;
    for (const r of records) {
      if (r.type === 'ai-title' && typeof r.aiTitle === 'string' && r.aiTitle.trim()) {
        name = r.aiTitle.trim();
      }
    }

    // Index every id-bearing record and its children so we can walk top-down.
    const byId = new Map<string, ClaudeCodeRecord>();
    const children = new Map<string, string[]>();
    const roots: string[] = [];
    for (const r of records) {
      if (typeof r.uuid !== 'string') continue;
      if (byId.has(r.uuid)) continue;
      byId.set(r.uuid, r);
      if (typeof r.parentUuid === 'string') {
        const list = children.get(r.parentUuid) ?? [];
        list.push(r.uuid);
        children.set(r.parentUuid, list);
      } else {
        roots.push(r.uuid);
      }
    }
    // A parent referenced but never defined also makes its children roots.
    for (const parentId of children.keys()) {
      if (!byId.has(parentId)) roots.push(...children.get(parentId)!);
    }

    // Walk the tree, keeping visible turns and bridging across skipped records.
    const messages: ImportedMessage[] = [];
    const visit = (id: string, keptParentId: string | null, guard: Set<string>) => {
      if (guard.has(id)) return;
      guard.add(id);
      const r = byId.get(id);
      if (!r) return;

      let nextParent = keptParentId;
      if (r.type === 'user' || r.type === 'assistant') {
        const text =
          r.type === 'user' ? userText(r.message?.content) : assistantText(r.message?.content);
        if (text) {
          messages.push({
            id,
            parentId: keptParentId,
            role: r.type,
            content: text,
            createdAt: r.timestamp,
            provider: r.type === 'assistant' ? 'anthropic' : null,
            model: r.type === 'assistant' ? r.message?.model ?? null : null
          });
          nextParent = id;
        }
      }
      for (const childId of children.get(id) ?? []) visit(childId, nextParent, guard);
    };
    const guard = new Set<string>();
    for (const rootId of roots) visit(rootId, null, guard);

    // One assistant turn is often stored as several consecutive text records
    // (separated in the file by tool activity we skipped). Merge an assistant
    // message into its assistant parent so each reply reads as one message.
    const merged = new Map<string, ImportedMessage>();
    const remap = new Map<string, string>();
    const out: ImportedMessage[] = [];
    for (const m of messages) {
      const parentId = m.parentId ? remap.get(m.parentId) ?? m.parentId : null;
      const parent = parentId ? merged.get(parentId) : undefined;
      if (m.role === 'assistant' && parent && parent.role === 'assistant') {
        parent.content += '\n\n' + m.content;
        remap.set(m.id, parent.id);
        continue;
      }
      const copy: ImportedMessage = { ...m, parentId };
      merged.set(copy.id, copy);
      out.push(copy);
    }

    if (out.length === 0) return [];
    return [{ name, messages: out }];
  }
};
