// Importer for ChatGPT data exports (the conversations.json file).
//
// Plain-English big picture:
// ChatGPT lets every user download their full history (Settings -> Data
// controls -> Export data). The download contains conversations.json, and --
// usefully for us -- each conversation in it is ALREADY a tree: every message
// node records its parent and children, because regenerating or editing a
// message creates a sibling branch. ChatGPT's own UI hides those branches;
// Traceback shows them. This parser walks that tree, keeps the human-visible
// user/assistant messages, and rebuilds the same structure in our neutral
// format -- branches intact.
//
// The file also contains plumbing we must skip: hidden system notes, tool
// calls, and empty placeholder nodes. When we skip a node we reattach its
// children to the nearest KEPT ancestor, so the visible conversation keeps its
// shape even though invisible steps sat in between.

import type { ImportedConversation, ImportedMessage } from './types.js';
import { BaseImporter } from './base.js';

// Minimal view of the parts of ChatGPT's format we read.
interface ChatGptNode {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: {
    author?: { role?: string };
    create_time?: number | null;
    content?: { content_type?: string; parts?: unknown[]; text?: string };
    metadata?: { model_slug?: string };
  } | null;
}
interface ChatGptConversation {
  title?: string | null;
  mapping?: Record<string, ChatGptNode>;
}

// Pull displayable text out of a node's content, or null if there is none.
function extractText(content: { content_type?: string; parts?: unknown[]; text?: string } | undefined): string | null {
  if (!content) return null;
  const type = content.content_type;
  if (type === 'text' || type === 'multimodal_text') {
    const parts = (content.parts ?? []).filter((p): p is string => typeof p === 'string');
    const joined = parts.join('\n').trim();
    return joined || null;
  }
  if (type === 'code' && typeof content.text === 'string' && content.text.trim()) {
    return '```\n' + content.text + '\n```';
  }
  return null;
}

function parseConversation(conv: ChatGptConversation): ImportedConversation | null {
  const mapping = conv.mapping;
  if (!mapping || typeof mapping !== 'object') return null;

  // Find the roots (nodes with no parent) so we can walk top-down.
  const rootIds = Object.keys(mapping).filter((id) => !mapping[id]?.parent);

  const messages: ImportedMessage[] = [];

  // Walk the tree depth-first. `keptParentId` is the nearest ancestor we kept,
  // which becomes the parent of the next kept node -- this is how skipped
  // plumbing nodes disappear without breaking the chain.
  const walk = (nodeId: string, keptParentId: string | null, guard: Set<string>) => {
    if (guard.has(nodeId)) return; // malformed file with a cycle; refuse to loop
    guard.add(nodeId);

    const node = mapping[nodeId];
    if (!node) return;

    const role = node.message?.author?.role;
    const text = node.message ? extractText(node.message.content) : null;
    const keep = (role === 'user' || role === 'assistant') && text !== null;

    let nextParent = keptParentId;
    if (keep) {
      const created = node.message?.create_time;
      const modelSlug = node.message?.metadata?.model_slug;
      messages.push({
        id: nodeId,
        parentId: keptParentId,
        role: role as 'user' | 'assistant',
        content: text!,
        createdAt: typeof created === 'number' ? new Date(created * 1000).toISOString() : undefined,
        provider: modelSlug ? 'openai' : null,
        model: modelSlug ?? null
      });
      nextParent = nodeId;
    }

    for (const childId of node.children ?? []) {
      walk(childId, nextParent, guard);
    }
  };

  const guard = new Set<string>();
  for (const rootId of rootIds) walk(rootId, null, guard);

  if (messages.length === 0) return null;
  return { name: conv.title?.trim() || null, messages };
}

export class ChatGptImporter extends BaseImporter {
  readonly id = 'chatgpt';

  // A ChatGPT export is an array of conversations, each carrying a `mapping`
  // object of message nodes.
  detect(data: unknown): boolean {
    return (
      Array.isArray(data) &&
      data.length > 0 &&
      data.every((c) => c && typeof c === 'object' && 'mapping' in (c as object))
    );
  }

  parse(data: unknown): ImportedConversation[] {
    if (!this.detect(data)) return [];
    const out: ImportedConversation[] = [];
    for (const conv of data as ChatGptConversation[]) {
      const parsed = parseConversation(conv);
      if (parsed) out.push(parsed);
    }
    return out;
  }
}

export const chatgptImporter = new ChatGptImporter();
