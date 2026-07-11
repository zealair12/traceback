// The conversation tree as a plain object -- no React anywhere.
//
// Plain-English big picture:
// Given the flat list of messages and which one is active, this class derives
// everything the interface needs to draw and navigate the tree: the linear
// thread from the root to the active message, the highlighted path, the
// question nodes and edges for the tree panel, and the sibling-branch info
// for the pager. Because it is framework-free, embedders building their own
// interface can reuse the exact same tree logic without React.

import type { Edge, Node } from '@xyflow/react';
import type { MessageResponse } from '@traceback/shared';
import type { ChatMessage } from '../types';
import { stripMarkdown } from '../utils/text';

// Where the active message sits among its sibling branches.
export interface SiblingInfo {
  parentId: string | null;
  siblings: MessageResponse[];
  currentIndex: number;
  total: number;
}

// A short graph-node label. Agent steps get a humanized label (e.g. "Search:
// flights…", "Result", or the answer preview) instead of raw tool JSON.
function nodeLabel(m: MessageResponse): string {
  if (m.provider === 'agent') {
    if (m.branchLabel === 'tool_call') {
      const match = /^\*\*(\w+)\*\*\s*([\s\S]*)$/.exec(m.content);
      const tool = match?.[1] ?? 'tool';
      if (tool === 'web_search') {
        try {
          const q = JSON.parse((match?.[2] ?? '').trim()).query;
          if (q) return `Search: ${q}`;
        } catch {
          /* fall through */
        }
        return 'Web search';
      }
      return tool.replace(/_/g, ' ');
    }
    if (m.branchLabel === 'tool_result') return 'Result';
    // final answer node
    return stripMarkdown(m.content);
  }
  return stripMarkdown(m.content);
}

export class ConversationTree {
  // The linear path root -> active message (what the chat panel shows; it
  // mirrors the pruned context the server sends to the model).
  readonly threadPath: ChatMessage[];
  // Ids on that path, for highlighting.
  readonly activePathIds: Set<string>;
  // Question nodes and edges for the tree panel (only user messages are
  // drawn; edges connect each question to its nearest question ancestor).
  readonly nodes: Node[];
  readonly edges: Edge[];
  // The active message's position among its sibling branches.
  readonly siblingInfo: SiblingInfo | null;

  constructor(messages: MessageResponse[], activeNodeId: string | null) {
    const byId = new Map(messages.map((m) => [m.id, m]));

    // Thread path: walk up the parents from the active message.
    const path: ChatMessage[] = [];
    let current = activeNodeId ? byId.get(activeNodeId) : undefined;
    while (current) {
      path.unshift({
        id: current.id,
        role: current.role,
        content: current.content,
        provider: current.provider,
        model: current.model,
        attachments: current.attachments,
        branchLabel: current.branchLabel
      });
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    this.threadPath = path;
    this.activePathIds = new Set(path.map((m) => m.id));

    // Graph nodes: user questions AND agent steps (so an agent run shows its
    // work — search, result, answer — as a visible chain). Ordinary assistant
    // chat replies are still skipped, so a normal conversation reads
    // question-to-question.
    const isNode = (m: MessageResponse) => m.role === 'user' || m.provider === 'agent';
    const nodeMessages = messages.filter(isNode);
    const nodeIds = new Set(nodeMessages.map((m) => m.id));
    const nodeParent = new Map<string, string | null>();
    for (const m of nodeMessages) {
      let cur = m.parentId;
      while (cur) {
        if (nodeIds.has(cur)) break;
        cur = byId.get(cur)?.parentId ?? null;
      }
      nodeParent.set(m.id, cur);
    }
    const childCount = new Map<string, number>();
    for (const m of nodeMessages) {
      const p = nodeParent.get(m.id);
      if (p) childCount.set(p, (childCount.get(p) ?? 0) + 1);
    }

    this.nodes = nodeMessages.map((m) => {
      const t = nodeLabel(m);
      const time = new Date(m.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
      return {
        id: m.id,
        type: 'custom',
        data: {
          label: t.length > 40 ? t.slice(0, 40) + '…' : t,
          timestamp: time,
          isActive: m.id === activeNodeId || this.activePathIds.has(m.id),
          isOnActivePath: this.activePathIds.has(m.id)
        },
        position: { x: 0, y: 0 }
      };
    });
    this.edges = nodeMessages
      .filter((m) => nodeParent.get(m.id))
      .map((m) => ({
        id: `e-${nodeParent.get(m.id)}-${m.id}`,
        source: nodeParent.get(m.id)!,
        target: m.id
      }));

    // Sibling branches at the active message.
    const activeMsg = activeNodeId ? byId.get(activeNodeId) : undefined;
    if (!activeMsg) {
      this.siblingInfo = null;
    } else {
      const siblings = messages
        .filter((m) => m.parentId === activeMsg.parentId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      this.siblingInfo = {
        parentId: activeMsg.parentId,
        siblings,
        currentIndex: siblings.findIndex((m) => m.id === activeNodeId),
        total: siblings.length
      };
    }
  }
}
