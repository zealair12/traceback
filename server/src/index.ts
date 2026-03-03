import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import { prisma } from './prismaClient.js';
import {
  createMessageWithAutoReply,
  ApiRateLimitError,
  LlmTimeoutError
} from './services/messageService.js';

const app = express();
const port = process.env.PORT ?? 4000;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? '*',
    credentials: true
  })
);

app.use(express.json());

// --- Routes -----------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// List all sessions (used by the sidebar).
app.get('/sessions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { updatedAt: 'desc' }
    });
    res.json(sessions);
  } catch (error: unknown) {
    next(error);
  }
});

// Create a new session.
app.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body ?? {};
    const session = await prisma.session.create({
      data: { name: typeof name === 'string' ? name : null }
    });
    res.status(201).json(session);
  } catch (error: unknown) {
    next(error);
  }
});

// Fetch the full tree of messages for a session (for React Flow).
app.get('/sessions/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messages = await prisma.message.findMany({
      where: { sessionId: req.params.id },
      orderBy: { createdAt: 'asc' }
    });
    res.json(messages);
  } catch (error: unknown) {
    next(error);
  }
});

// Send a new user message -> get LLM reply.
app.post('/message/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { session_id: sessionId, parent_id: parentIdRaw, content } = req.body ?? {};

    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'session_id is required and must be a string.' });
      return;
    }
    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required and must be a string.' });
      return;
    }

    const parentId = parentIdRaw ? String(parentIdRaw) : null;

    const result = await createMessageWithAutoReply({ sessionId, parentId, content });

    res.status(201).json({
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      lineage: result.lineage
    });
  } catch (error: unknown) {
    next(error);
  }
});

// Delete a message and its entire subtree (cascade via foreign key).
app.delete('/messages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await prisma.$executeRaw`
      WITH RECURSIVE subtree AS (
        SELECT id FROM messages WHERE id = CAST(${id} AS uuid)
        UNION ALL
        SELECT m.id FROM messages m INNER JOIN subtree s ON m.parent_id = s.id
      )
      DELETE FROM messages WHERE id IN (SELECT id FROM subtree);
    `;
    res.json({ deleted: true });
  } catch (error: unknown) {
    next(error);
  }
});

// --- Error handling ---------------------------------------------------------

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  let label = 'Unknown Error';

  if (err instanceof ApiRateLimitError) {
    label = 'API Rate Limit';
    status = 429;
  } else if (err instanceof LlmTimeoutError) {
    label = 'LLM Timeout';
    status = 504;
  } else if (err instanceof Error) {
    label = err.name || 'Application Error';
  }

  console.error(`[${label}]`, err);

  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(status).json({ error: message, type: label });
});

// --- Server bootstrap -------------------------------------------------------

app.listen(port, () => {
  console.log(`TraceBack server listening on http://localhost:${port}`);
});
