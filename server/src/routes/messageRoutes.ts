// Message routes: send a turn into the tree, or prune a branch out of it.
// Guests are limited to GUEST_DAILY_LIMIT messages per day (counted by their
// cookie-scoped guestId). Signed-in users have no limit.

import type { Express } from 'express';
import { prisma } from '../prismaClient.js';
import { createMessageWithAutoReply } from '../services/messageService.js';
import { resolveApiKey } from '../auth/apiKey.js';
import { ownerWhere } from '../auth/owner.js';
import { wrap } from './wrap.js';

const GUEST_DAILY_LIMIT = Number(process.env.GUEST_DAILY_LIMIT ?? 5);

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

      // Rate-limit guests.
      if (!req.isAuthenticated()) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const used = await prisma.message.count({
          where: {
            role: 'user',
            createdAt: { gte: today },
            session: { guestId: req.session.guestId }
          }
        });
        if (used >= GUEST_DAILY_LIMIT) {
          res.status(429).json({
            error: `You've used your ${GUEST_DAILY_LIMIT} free messages for today. Sign in to continue without limits.`,
            guestLimitReached: true
          });
          return;
        }
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
