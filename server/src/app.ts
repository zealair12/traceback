// Builds the Express application (middleware + routes) and returns it WITHOUT
// starting to listen, so the normal server, the tests, and any embedder all
// share the exact same application.
//
// Each route family lives in its own module under routes/; this file only
// assembles them and owns the shared error handling.

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import passport from 'passport';
import './auth/google.js';

import { Prisma } from '@prisma/client';
import { prisma } from './prismaClient.js';
import { ApiRateLimitError, LlmTimeoutError } from './services/messageService.js';
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
import { registerAgentRoutes } from './routes/agentRoutes.js';
import { wrap } from './routes/wrap.js';

export function createApp() {
  const app = express();

  // Railway (and most PaaS) sits behind a reverse proxy that terminates TLS.
  // Without this, req.secure is always false and secure cookies don't work.
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? '*',
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-provider-key']
    })
  );

  app.use(express.json({ limit: '20mb' }));

  // COOKIE_SECURE=true in Railway; leave unset for local http dev.
  const secureCookies = process.env.COOKIE_SECURE === 'true';

  // Persist sessions in Postgres so they survive restarts/redeploys and work
  // across instances. The default in-memory store dropped every session on
  // each deploy, which logged users out and made their chats look "expired."
  const PgSession = connectPgSimple(session);
  const sessionPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  app.use(session({
    store: new PgSession({ pool: sessionPool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET ?? 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: secureCookies,
      sameSite: secureCookies ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  // Assign a stable guest ID to every unauthenticated visitor. This scopes
  // their sessions so they only see their own data before signing in.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() && !req.session.guestId) {
      req.session.guestId = req.sessionID;
    }
    next();
  });

  // --- Routes ---------------------------------------------------------------

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

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
        memory: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed },
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

  // Session + message routes (scoped to the caller's account or guest cookie).
  registerSessionRoutes(app);
  registerMessageRoutes(app);
  registerAgentRoutes(app);

  // OpenAI-compatible proxy + file imports + audio transcription.
  registerOpenAiProxy(app);
  registerImportRoutes(app);
  registerTranscribeRoutes(app);

  // --- Auth routes ----------------------------------------------------------

  app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  // After Google redirects back, transfer any sessions the user created as a
  // guest so their history is waiting for them when they land on the app.
  app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    wrap(async (req: Request, res: Response) => {
      const guestId = req.session.guestId;
      const user = req.user as any;
      if (guestId && user?.id) {
        await prisma.session.updateMany({
          where: { guestId },
          data: { userId: user.id, guestId: null }
        });
        delete req.session.guestId;
      }
      res.redirect((process.env.CLIENT_ORIGIN ?? '') + '/app');
    })
  );

  // Returns the signed-in user, or guest status + today's usage for guests.
  app.get(
    '/auth/me',
    wrap(async (req: Request, res: Response) => {
      if (req.isAuthenticated()) {
        const user = req.user as any;
        res.json({ id: user.id, name: user.name, email: user.email, avatar: user.avatar, isGuest: false });
        return;
      }
      // Guest message counting is retired (sign-in is required). Left commented so
      // no per-request DB count runs for anonymous visitors (which could hang).
      // const dailyLimit = Number(process.env.GUEST_DAILY_LIMIT ?? 5);
      // const today = new Date(); today.setHours(0, 0, 0, 0);
      // const used = await prisma.message.count({
      //   where: { role: 'user', createdAt: { gte: today }, session: { guestId: req.session.guestId } }
      // });
      res.json({ isGuest: true, dailyLimit: 0, messagesUsedToday: 0 });
    })
  );

  app.post('/auth/logout', (req: Request, res: Response) => {
    req.logout(() => {
      req.session.destroy(() => res.json({ success: true }));
    });
  });

  // --- Error handling -------------------------------------------------------

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let label = 'Unknown Error';

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
