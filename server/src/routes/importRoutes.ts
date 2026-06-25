// Import endpoint: write previously-exported conversations into the tree store.
//
// Plain-English big picture:
// The browser (or any API client) parses an export file -- say ChatGPT's
// conversations.json -- into a neutral shape: conversations whose messages each
// point at their parent. This endpoint takes that neutral shape, gives every
// message a fresh id, computes its depth, and writes the whole tree to the
// database. From that moment the imported history behaves exactly like native
// Traceback history: it renders as a tree, branches are visible, and any node
// can be continued with any model -- because context is assembled from OUR
// database at send time, not from the product the data came from.

import { randomUUID } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { prisma } from '../prismaClient.js';
import { getOwner } from '../auth/owner.js';

interface IncomingImportedMessage {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  provider?: string | null;
  model?: string | null;
}
interface IncomingImportedConversation {
  name: string | null;
  messages: IncomingImportedMessage[];
}

// Check one conversation's structure; returns an error string or null if fine.
// Parents must appear before their children so depth can be computed in one pass.
function validateConversation(conv: unknown, index: number): string | null {
  const c = conv as IncomingImportedConversation;
  if (!c || typeof c !== 'object' || !Array.isArray(c.messages) || c.messages.length === 0) {
    return `conversation ${index}: must have a non-empty messages array.`;
  }
  const seen = new Set<string>();
  for (const m of c.messages) {
    if (!m || typeof m.id !== 'string' || !m.id) return `conversation ${index}: every message needs an id.`;
    if (seen.has(m.id)) return `conversation ${index}: duplicate message id "${m.id}".`;
    if (m.role !== 'user' && m.role !== 'assistant') {
      return `conversation ${index}: role must be user or assistant.`;
    }
    if (typeof m.content !== 'string' || !m.content.trim()) {
      return `conversation ${index}: every message needs text content.`;
    }
    if (m.parentId !== null && typeof m.parentId !== 'string') {
      return `conversation ${index}: parentId must be a string or null.`;
    }
    if (m.parentId && !seen.has(m.parentId)) {
      return `conversation ${index}: message "${m.id}" references parent "${m.parentId}" that does not appear before it.`;
    }
    seen.add(m.id);
  }
  return null;
}

export function registerImportRoutes(app: Express) {
  app.post('/import', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const conversations = (req.body ?? {}).conversations;
      if (!Array.isArray(conversations) || conversations.length === 0) {
        res.status(400).json({ error: 'conversations must be a non-empty array.' });
        return;
      }

      // Validate everything before writing anything, so a bad file never
      // leaves a half-imported mess.
      for (let i = 0; i < conversations.length; i++) {
        const problem = validateConversation(conversations[i], i);
        if (problem) {
          res.status(400).json({ error: problem });
          return;
        }
      }

      const imported: Array<{ sessionId: string; name: string | null; messageCount: number }> = [];

      // Stamp the owner so imported/seeded sessions belong to the caller and are
      // visible after reload (ownerWhere filters by these).
      const owner = getOwner(req);

      for (const conv of conversations as IncomingImportedConversation[]) {
        const session = await prisma.session.create({
          data: {
            name: typeof conv.name === 'string' && conv.name.trim() ? conv.name.trim() : null,
            ...(owner.userId ? { userId: owner.userId } : { guestId: owner.guestId })
          }
        });

        // Translate the file's ids into fresh database ids, and compute each
        // message's depth from its parent (parents always come first).
        const newIdByOldId = new Map<string, string>();
        const depthByNewId = new Map<string, number>();
        const rows = conv.messages.map((m) => {
          const newId = randomUUID();
          newIdByOldId.set(m.id, newId);
          const newParentId = m.parentId ? newIdByOldId.get(m.parentId)! : null;
          const depth = newParentId ? (depthByNewId.get(newParentId) ?? 0) + 1 : 0;
          depthByNewId.set(newId, depth);
          const created = m.createdAt ? new Date(m.createdAt) : undefined;
          return {
            id: newId,
            sessionId: session.id,
            parentId: newParentId,
            role: m.role,
            content: m.content,
            depth,
            provider: m.provider ?? null,
            model: m.model ?? null,
            // Keep the original timestamp when it parses; otherwise "now".
            ...(created && !isNaN(created.getTime()) ? { createdAt: created } : {})
          };
        });

        await prisma.message.createMany({ data: rows });
        imported.push({ sessionId: session.id, name: session.name, messageCount: rows.length });
      }

      res.status(201).json({ imported });
    } catch (error: unknown) {
      next(error);
    }
  });
}
