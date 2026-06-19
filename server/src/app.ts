// Builds the Express application (middleware + routes) and returns it WITHOUT
// starting to listen, so the normal server, the tests, and any embedder all
// share the exact same application.
//
// Each route family lives in its own module under routes/; this file only
// assembles them and owns the shared error handling.

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import './auth/google.js';

import { Prisma } from '@prisma/client';
import { prisma } from './prismaClient.js';
import { ApiRateLimitError, LlmTimeoutError } from './services/messageService.js';
import { createMessageWithAutoReply } from './services/messageService.js';
import {
  listProviders,
  defaultProviderId,
  ProviderNotAvailableError,
  InsecureKeyTransportError
} from './providers/index.js';
import { registerSessionRoutes } from './routes/sessionRoutes.js';
import { registerMessageRoutes } from './routes/messageRoutes.js';
import { registerOpenAiProxy } from './routes/openaiProxy.js';
import { registerImportRoutes } from './routes/importRoutes.js';
import { registerTranscribeRoutes } from './routes/transcribeRoutes.js';
import { resolveApiKey } from './auth/apiKey.js';
import { wrap } from './routes/wrap.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? '*',
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-provider-key']
    })
  );

  app.use(express.json({ limit: '20mb' }));

  app.use(session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  // --- Routes ---------------------------------------------------------------

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Lightweight local metrics for perf scripts / debugging.
  app.get(
    '/debug/metrics',
    wrap(async (_req, res) => {
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
        counts: { sessions: sessionCount, messages: messageCount },
        timestamp: new Date().toISOString()
      });
    })
  );

  // The model picker's menu: which backends exist, what they can do, and which
  // are configured. Never exposes any API keys.
  app.get('/providers', (_req: Request, res: Response) => {
    res.json({ default: defaultProviderId(), providers: listProviders() });
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

  // Delete a session and all its messages (cascade via Prisma schema).
  app.delete('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.session.delete({ where: { id: req.params.id } });
      res.json({ deleted: true });
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
        model: modelRaw,
        attachments: attachmentsRaw
      } = req.body ?? {};

      if (!sessionId || typeof sessionId !== 'string') {
        res.status(400).json({ error: 'session_id is required and must be a string.' });
        return;
      }
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'content must be a string.' });
        return;
      }
      // Empty text is fine as long as there is at least one attachment.
      if (!content && (!Array.isArray(attachmentsRaw) || attachmentsRaw.length === 0)) {
        res.status(400).json({ error: 'Please type a message or attach a file.' });
        return;
      }

      const parentId = parentIdRaw ? String(parentIdRaw) : null;
      const provider = typeof providerRaw === 'string' && providerRaw ? providerRaw : undefined;
      const model = typeof modelRaw === 'string' && modelRaw ? modelRaw : undefined;
      const apiKey = resolveApiKey(req);

      // Guard: verify the session still exists before starting a transaction.
      // If another tab or user deleted it, give a clear message rather than
      // a raw Prisma foreign-key constraint error.
      const sessionExists = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true }
      });
      if (!sessionExists) {
        res.status(404).json({ error: 'This chat session no longer exists. Please start a new chat.' });
        return;
      }

      const result = await createMessageWithAutoReply({
        sessionId, parentId, content, provider, model, apiKey,
        attachments: Array.isArray(attachmentsRaw) ? attachmentsRaw : undefined
      });

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

  // --- Google OAuth routes --------------------------------------------------

  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req: Request, res: Response) => res.redirect(process.env.CLIENT_ORIGIN + '/')
  );

  app.get('/auth/me', (req: Request, res: Response) => {
    if (req.isAuthenticated()) res.json(req.user);
    else res.status(401).json({ error: 'Not logged in' });
  });

  app.post('/auth/logout', (req: Request, res: Response) => {
    req.logout(() => res.json({ success: true }));
  });

  // OpenAI-compatible proxy endpoint (POST /v1/chat/completions). Registered
  // before the error handler so its errors are handled the same way.
  registerOpenAiProxy(app);
  registerImportRoutes(app);
  registerTranscribeRoutes(app);

  // Shared error handling: map known failure types onto helpful statuses.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let label = 'Unknown Error';

    // Prisma FK violation — almost always means the session was deleted mid-chat.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      console.error('[FK Constraint]', err.message);
      res.status(400).json({ error: 'This chat session no longer exists. Please start a new chat.' });
      return;
    }

    if (err instanceof ApiRateLimitError) {
      label = 'API Rate Limit';
      status = 429;
    } else if (err instanceof LlmTimeoutError) {
      label = 'LLM Timeout';
      status = 504;
    } else if (err instanceof ProviderNotAvailableError) {
      label = 'Provider Not Available';
      status = 400;
    } else if (err instanceof InsecureKeyTransportError) {
      label = 'Insecure Key Transport';
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
