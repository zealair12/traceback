// Session routes: the conversation list and its contents.
//
// Plain-English: a session is one conversation tree. These routes list them
// (sidebar), create and rename them, and fetch a session's full message tree
// (what the tree panel draws).

import type { Express, Request, Response } from 'express';
import { prisma } from '../prismaClient.js';
import { wrap } from './wrap.js';

export function registerSessionRoutes(app: Express) {
  // List all sessions, newest activity first.
  app.get(
    '/sessions',
    wrap(async (_req, res) => {
      const sessions = await prisma.session.findMany({ orderBy: { updatedAt: 'desc' } });
      res.json(sessions);
    })
  );

  // Create a new session.
  app.post(
    '/sessions',
    wrap(async (req, res) => {
      const { name } = req.body ?? {};
      const session = await prisma.session.create({
        data: { name: typeof name === 'string' ? name : null }
      });
      res.status(201).json(session);
    })
  );

  // Rename a session.
  app.patch(
    '/sessions/:id',
    wrap(async (req: Request, res: Response) => {
      const { name } = req.body ?? {};
      if (name !== null && typeof name !== 'string') {
        res.status(400).json({ error: 'name must be a string or null.' });
        return;
      }
      const session = await prisma.session.update({
        where: { id: req.params.id },
        data: { name: name && name.trim() ? name.trim() : null }
      });
      res.json(session);
    })
  );

  // Fetch the full tree of messages for a session (for React Flow).
  app.get(
    '/sessions/:id/messages',
    wrap(async (req, res) => {
      const messages = await prisma.message.findMany({
        where: { sessionId: req.params.id },
        orderBy: { createdAt: 'asc' }
      });
      res.json(messages);
    })
  );
}
