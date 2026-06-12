// Builds the Express application (middleware + routes) and returns it WITHOUT
// starting to listen, so the normal server, the tests, and any embedder all
// share the exact same application.
//
// Each route family lives in its own module under routes/; this file only
// assembles them and owns the shared error handling.

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';

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
import { wrap } from './routes/wrap.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? '*', credentials: true }));
  // Imported chat-history files can be several megabytes, so allow bodies well
  // beyond the 100kb default.
  app.use(express.json({ limit: '50mb' }));

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

  registerSessionRoutes(app);
  registerMessageRoutes(app);
  registerOpenAiProxy(app);
  registerImportRoutes(app);
  registerTranscribeRoutes(app);

  // Shared error handling: map known failure types onto helpful statuses.
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
