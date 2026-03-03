// Entry point for the TraceBack Express server.
// This file wires together:
// - Express HTTP server and middleware.
// - Core route for sending messages (`POST /message/send`).
// - Error handling and graceful responses for edge cases.
//
// The actual business logic for dealing with messages and
// database access lives in the `messageService` module.

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { prisma } from './prismaClient.js';
import {
  createMessageWithAutoReply,
  ApiRateLimitError,
  LlmTimeoutError
} from './services/messageService.js';

dotenv.config();

const app = express();
const port = process.env.PORT ?? 4000;

// --- Middleware -------------------------------------------------------------

// Allow the React client (running on another port) to talk to this API.
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? '*',
    credentials: true
  })
);

// Parse JSON bodies for incoming requests.
app.use(express.json());

// --- Routes -----------------------------------------------------------------

// Simple endpoint to create a new session.
// This is primarily used by scripts/tests and the frontend sidebar.
//
// Request body (minimal):
// {
//   name?: string
// }
//
// Response:
// {
//   id: string,
//   name?: string,
//   createdAt: string,
//   updatedAt: string
// }
app.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body ?? {};
    const session = await prisma.session.create({
      data: {
        name: typeof name === 'string' ? name : null
      }
    });

    res.status(201).json(session);
  } catch (error: unknown) {
    next(error);
  }
});

// Health check endpoint so we can quickly verify the server is online.
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Core route used by the frontend to send a new user message.
//
// Request body:
// {
//   session_id: string,
//   parent_id?: string | null,
//   content: string
// }
//
// Response body (simplified example):
// {
//   userMessage: Message,
//   assistantMessage: Message,
//   lineage: LineageMessage[]
// }
//
// The frontend can:
// - Use `lineage` to render the linear path in the chat panel.
// - Use `userMessage` and `assistantMessage` to update the tree view.
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

    const result = await createMessageWithAutoReply({
      sessionId,
      parentId,
      content
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

// --- Error handling ---------------------------------------------------------

// Centralized error handler so that all errors are formatted consistently.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  let label = 'Unknown Error';

  if (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientValidationError
  ) {
    label = 'Database Error';
  } else if (err instanceof ApiRateLimitError) {
    label = 'API Rate Limit';
    status = 429;
  } else if (err instanceof LlmTimeoutError) {
    label = 'LLM Timeout';
    status = 504;
  } else if (err instanceof Error) {
    label = err.name || 'Application Error';
  }

  // For now we just log to stdout with a clear label.
  // eslint-disable-next-line no-console
  console.error(`[${label}]`, err);

  const message = err instanceof Error ? err.message : 'Internal server error';

  res.status(status).json({
    error: message,
    type: label
  });
});

// --- Server bootstrap -------------------------------------------------------

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`TraceBack server listening on http://localhost:${port}`);
});

