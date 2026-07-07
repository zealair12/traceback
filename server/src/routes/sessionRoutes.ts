// Session routes: the conversation list and its contents.
// Every query is scoped to the owner (signed-in user or guest cookie) so
// nobody can read or modify another person's sessions.

import type { Express, Request, Response } from 'express';
import { prisma } from '../prismaClient.js';
import { ownerWhere } from '../auth/owner.js';
import { getProvider } from '../providers/index.js';
import { wrap } from './wrap.js';

export function registerSessionRoutes(app: Express) {
  // Auto-name an untitled chat from its first user message, using the LLM for a
  // context-aware title. Best-effort and owner-gated. Only writes while the name
  // is still empty, so a name the user set (or an earlier auto-name) is retained.
  app.post(
    '/sessions/:id/autoname',
    wrap(async (req: Request, res: Response) => {
      const session = await prisma.session.findFirst({
        where: { id: req.params.id, ...ownerWhere(req) }
      });
      if (!session) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }
      // Already named (manually or before): keep it.
      if (session.name && session.name.trim()) {
        res.json(session);
        return;
      }
      const firstUser = await prisma.message.findFirst({
        where: { sessionId: session.id, role: 'user' },
        orderBy: { createdAt: 'asc' },
        select: { content: true }
      });
      if (!firstUser?.content?.trim()) {
        res.json(session);
        return;
      }

      let title = '';
      try {
        const raw = await getProvider().complete(
          [
            {
              role: 'system',
              content:
                'Generate a concise 3 to 5 word title for a conversation that begins with the message below. Reply with only the title: no quotes, no trailing punctuation.'
            },
            { role: 'user', content: firstUser.content.slice(0, 2000) }
          ],
          { maxTokens: 20 }
        );
        title = raw
          .replace(/^["'\s]+|["'\s]+$/g, '')
          .replace(/[\r\n]+/g, ' ')
          .replace(/[.?!,;:]+$/, '')
          .slice(0, 60)
          .trim();
      } catch {
        /* fall through; leave untitled if the model call fails */
      }
      if (!title) {
        res.json(session);
        return;
      }

      // Only set the name if it's still empty, so a rename during the LLM call
      // (or a concurrent auto-name) is not clobbered.
      await prisma.session.updateMany({ where: { id: session.id, name: null }, data: { name: title } });
      const updated = await prisma.session.findUnique({ where: { id: session.id } });
      res.json(updated ?? session);
    })
  );

  // List the caller's sessions, newest activity first.
  app.get(
    '/sessions',
    wrap(async (req, res) => {
      const sessions = await prisma.session.findMany({
        where: ownerWhere(req),
        orderBy: { updatedAt: 'desc' }
      });
      res.json(sessions);
    })
  );

  // Create a new session owned by the caller.
  app.post(
    '/sessions',
    wrap(async (req, res) => {
      const { name } = req.body ?? {};
      const user = req.user as any;
      const session = await prisma.session.create({
        data: {
          name: typeof name === 'string' ? name : null,
          ...(user?.id ? { userId: user.id } : { guestId: req.session.guestId })
        }
      });
      res.status(201).json(session);
    })
  );

  // Rename a session (owner-gated).
  app.patch(
    '/sessions/:id',
    wrap(async (req: Request, res: Response) => {
      const { name } = req.body ?? {};
      if (name !== null && typeof name !== 'string') {
        res.status(400).json({ error: 'name must be a string or null.' });
        return;
      }
      const session = await prisma.session.findFirst({
        where: { id: req.params.id, ...ownerWhere(req) }
      });
      if (!session) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }
      const updated = await prisma.session.update({
        where: { id: req.params.id },
        data: { name: name && name.trim() ? name.trim() : null }
      });
      res.json(updated);
    })
  );

  // Delete a session and all its messages (owner-gated).
  app.delete(
    '/sessions/:id',
    wrap(async (req, res) => {
      const session = await prisma.session.findFirst({
        where: { id: req.params.id, ...ownerWhere(req) }
      });
      if (!session) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }
      await prisma.session.delete({ where: { id: req.params.id } });
      res.json({ deleted: true });
    })
  );

  // Fetch the full message tree for one session (owner-gated).
  app.get(
    '/sessions/:id/messages',
    wrap(async (req, res) => {
      const session = await prisma.session.findFirst({
        where: { id: req.params.id, ...ownerWhere(req) }
      });
      if (!session) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }
      const messages = await prisma.message.findMany({
        where: { sessionId: req.params.id },
        orderBy: { createdAt: 'asc' }
      });
      res.json(messages);
    })
  );
}
