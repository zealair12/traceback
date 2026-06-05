// Builds the Express application (routes + middleware) and returns it WITHOUT
// starting to listen.
//
// Plain-English big picture:
// Previously the server created the app and immediately started listening in one
// file, which made it impossible to import the app for tests or to mount extra
// routes cleanly. This factory just assembles the app and hands it back, so the
// normal server, tests, and the OpenAI-compatible proxy all share the exact same
// application.

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';

import { prisma } from './prismaClient.js';
import {
  createMessageWithAutoReply,
  ApiRateLimitError,
  LlmTimeoutError
} from './services/messageService.js';
import { listProviders, defaultProviderId, ProviderNotAvailableError } from './providers/index.js';
import { registerOpenAiProxy } from './routes/openaiProxy.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? '*',
      credentials: true
    })
  );

  app.use(express.json());

  // --- Routes ---------------------------------------------------------------

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Lightweight local metrics for perf scripts / debugging.
  app.get('/debug/metrics', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [sessionCount, messageCount] = await Promise.all([
        prisma.session.count(),
        prisma.message.count()
      ]);
      const mem = process.memoryUsage();
      res.json({
        pid: process.pid,
        uptimeSec: Number(process.uptime().toFixed(2)),
        memory: {
          rss: mem.rss,
          heapTotal: mem.heapTotal,
          heapUsed: mem.heapUsed,
          external: mem.external,
          arrayBuffers: mem.arrayBuffers
        },
        counts: {
          sessions: sessionCount,
          messages: messageCount
        },
        timestamp: new Date().toISOString()
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  // List the available LLM providers and their models, so a frontend can show a
  // "pick your model" menu (Cursor-style). Reports which provider is the default
  // and whether each one is configured, but never exposes any API keys.
  app.get('/providers', (_req: Request, res: Response) => {
    res.json({
      default: defaultProviderId(),
      providers: listProviders()
    });
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

  // Rename a session.
  app.patch('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
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
      const {
        session_id: sessionId,
        parent_id: parentIdRaw,
        content,
        provider: providerRaw,
        model: modelRaw
      } = req.body ?? {};

      if (!sessionId || typeof sessionId !== 'string') {
        res.status(400).json({ error: 'session_id is required and must be a string.' });
        return;
      }
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required and must be a string.' });
        return;
      }

      const parentId = parentIdRaw ? String(parentIdRaw) : null;
      // Optional per-message model choice. Left undefined when not supplied so
      // the service falls back to the app's default provider and model.
      const provider = typeof providerRaw === 'string' && providerRaw ? providerRaw : undefined;
      const model = typeof modelRaw === 'string' && modelRaw ? modelRaw : undefined;

      const result = await createMessageWithAutoReply({ sessionId, parentId, content, provider, model });

      res.status(201).json({
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage,
        lineage: result.lineage
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  // Delete a message and its entire subtree.
  // The message id columns are stored as text, so we compare against the id
  // directly. (A previous version cast the id to a uuid, which always failed
  // with "operator does not exist: text = uuid" because the column is text.)
  app.delete('/messages/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await prisma.$executeRaw`
        WITH RECURSIVE subtree AS (
          SELECT id FROM messages WHERE id = ${id}
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

  // OpenAI-compatible proxy endpoint (POST /v1/chat/completions). Registered
  // before the error handler so its errors are handled the same way.
  registerOpenAiProxy(app);

  // --- Error handling -------------------------------------------------------

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let label = 'Unknown Error';

    if (err instanceof ApiRateLimitError) {
      label = 'API Rate Limit';
      status = 429;
    } else if (err instanceof LlmTimeoutError) {
      label = 'LLM Timeout';
      status = 504;
    } else if (err instanceof ProviderNotAvailableError) {
      // The caller asked for a provider/model we do not know about: that is a
      // bad request, not a server fault.
      label = 'Provider Not Available';
      status = 400;
    } else if (err instanceof Error) {
      label = err.name || 'Application Error';
    }

    console.error(`[${label}]`, err);

    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(status).json({ error: message, type: label });
  });

  return app;
}
