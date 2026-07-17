// Message routes: send a turn into the tree, or prune a branch out of it.
// Sending requires a signed-in user (see AUTH_OPTIONAL for the local test relax).

import type { Express } from 'express';
import { prisma } from '../prismaClient.js';
import { createMessageWithAutoReply } from '../services/messageService.js';
import { resolveApiKey } from '../auth/apiKey.js';
import { ownerWhere } from '../auth/owner.js';
import { wrap } from './wrap.js';

// Sending requires sign-in. Set AUTH_OPTIONAL=true locally so the headless
// verify suite (which cannot do a real Google login) can still run. Never set it
// in production.
const AUTH_OPTIONAL = process.env.AUTH_OPTIONAL === 'true';

function attachmentsProblem(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length > 4) {
    return 'attachments must be an array of at most 4 items.';
  }
  for (const a of raw) {
    const sizeOk = typeof a?.dataUrl === 'string' && a.dataUrl.length <= 8_000_000;
    const imageOk =
      a?.type === 'image' &&
      typeof a.mediaType === 'string' &&
      a.mediaType.startsWith('image/') &&
      a.dataUrl?.startsWith('data:image/');
    const fileOk =
      a?.type === 'file' &&
      a.mediaType === 'application/pdf' &&
      a.dataUrl?.startsWith('data:application/pdf') &&
      (a.name === undefined || typeof a.name === 'string');
    if (!sizeOk || (!imageOk && !fileOk)) {
      return 'each attachment must be an image (image/*) or a PDF (application/pdf), as a base64 data URL under 6MB.';
    }
  }
  return null;
}

export function registerMessageRoutes(app: Express) {
  app.post(
    '/message/send',
    wrap(async (req, res) => {
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
      if (!content && (!Array.isArray(attachmentsRaw) || attachmentsRaw.length === 0)) {
        res.status(400).json({ error: 'Please type a message or attach a file.' });
        return;
      }
      if (content !== undefined && typeof content !== 'string') {
        res.status(400).json({ error: 'content must be a string.' });
        return;
      }
      const problem = attachmentsProblem(attachmentsRaw);
      if (problem) { res.status(400).json({ error: problem }); return; }

      // Verify the session belongs to this user/guest.
      const session = await prisma.session.findFirst({
        where: { id: sessionId, ...ownerWhere(req) }
      });
      if (!session) {
        res.status(404).json({ error: 'This chat session no longer exists. Please start a new chat.' });
        return;
      }

      // Sign-in required: no anonymous message sending.
      if (!AUTH_OPTIONAL && !req.isAuthenticated()) {
        res.status(401).json({ error: 'Please sign in to send messages.', authRequired: true });
        return;
      }

      const result = await createMessageWithAutoReply({
        sessionId,
        parentId: parentIdRaw ? String(parentIdRaw) : null,
        content: content ?? '',
        provider: typeof providerRaw === 'string' && providerRaw ? providerRaw : undefined,
        model: typeof modelRaw === 'string' && modelRaw ? modelRaw : undefined,
        apiKey: resolveApiKey(req),
        attachments: attachmentsRaw === undefined ? undefined : attachmentsRaw
      });

      res.status(201).json({
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage,
        lineage: result.lineage
      });
    })
  );

  // Streaming variant of /message/send: same validation, but the reply is
  // streamed to the client token by token over Server-Sent Events. The client
  // falls back to /message/send if this fails, so it is safe to add.
  app.post(
    '/message/stream',
    wrap(async (req, res) => {
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
      if (!content && (!Array.isArray(attachmentsRaw) || attachmentsRaw.length === 0)) {
        res.status(400).json({ error: 'Please type a message or attach a file.' });
        return;
      }
      if (content !== undefined && typeof content !== 'string') {
        res.status(400).json({ error: 'content must be a string.' });
        return;
      }
      const problem = attachmentsProblem(attachmentsRaw);
      if (problem) { res.status(400).json({ error: problem }); return; }

      const session = await prisma.session.findFirst({ where: { id: sessionId, ...ownerWhere(req) } });
      if (!session) {
        res.status(404).json({ error: 'This chat session no longer exists. Please start a new chat.' });
        return;
      }

      if (!AUTH_OPTIONAL && !req.isAuthenticated()) {
        res.status(401).json({ error: 'Please sign in to send messages.', authRequired: true });
        return;
      }

      // From here on we stream; errors are reported as SSE events, not HTTP codes.
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // don't let a proxy buffer the stream
      (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
      const emit = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      try {
        const result = await createMessageWithAutoReply({
          sessionId,
          parentId: parentIdRaw ? String(parentIdRaw) : null,
          content: content ?? '',
          provider: typeof providerRaw === 'string' && providerRaw ? providerRaw : undefined,
          model: typeof modelRaw === 'string' && modelRaw ? modelRaw : undefined,
          apiKey: resolveApiKey(req),
          attachments: attachmentsRaw === undefined ? undefined : attachmentsRaw,
          onToken: (chunk) => emit('token', { chunk })
        });
        emit('done', { userMessage: result.userMessage, assistantMessage: result.assistantMessage });
        res.end();
      } catch (err) {
        emit('error', { error: err instanceof Error ? err.message : 'Something went wrong' });
        res.end();
      }
    })
  );

  app.delete(
    '/messages/:id',
    wrap(async (req, res) => {
      const { id } = req.params;
      // Authorization: only let the caller delete a message that lives in a
      // session they own. Without this, anyone could prune another person's
      // subtree by supplying its message id.
      const owned = await prisma.message.findFirst({
        where: { id, session: ownerWhere(req) },
        select: { id: true }
      });
      if (!owned) {
        res.status(404).json({ error: 'Message not found.' });
        return;
      }
      await prisma.$executeRaw`
        WITH RECURSIVE subtree AS (
          SELECT id FROM messages WHERE id = ${id}
          UNION ALL
          SELECT m.id FROM messages m INNER JOIN subtree s ON m.parent_id = s.id
        )
        DELETE FROM messages WHERE id IN (SELECT id FROM subtree);
      `;
      res.json({ deleted: true });
    })
  );
}
