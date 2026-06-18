// Message routes: send a turn into the tree, or prune a branch out of it.
//
// Plain-English: POST /message/send stores the user's message, asks the chosen
// model for a reply using only the pruned branch context, and stores the
// reply. DELETE /messages/:id removes a message and everything beneath it.

import type { Express } from 'express';
import { prisma } from '../prismaClient.js';
import { createMessageWithAutoReply } from '../services/messageService.js';
import { resolveApiKey } from '../auth/apiKey.js';
import { wrap } from './wrap.js';

// Check the optional attachments list: a few images and/or PDFs, each carried
// as a bounded base64 data URL so one message cannot balloon the database or
// the model request. Returns an error sentence, or null when fine.
function attachmentsProblem(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length > 4) {
    return 'attachments must be an array of at most 4 items.';
  }
  for (const a of raw) {
    const sizeOk = typeof a?.dataUrl === 'string' && a.dataUrl.length <= 8_000_000; // ~6MB each
    const imageOk =
      a?.type === 'image' &&
      typeof a.mediaType === 'string' &&
      a.mediaType.startsWith('image/') &&
      a.dataUrl?.startsWith('data:image/');
    // Documents: PDFs travel whole; text-like files are inlined by the client
    // before sending, so only PDF reaches this endpoint as a file.
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
  // Send a new user message -> get LLM reply.
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
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required and must be a string.' });
        return;
      }
      const problem = attachmentsProblem(attachmentsRaw);
      if (problem) {
        res.status(400).json({ error: problem });
        return;
      }

      const result = await createMessageWithAutoReply({
        sessionId,
        parentId: parentIdRaw ? String(parentIdRaw) : null,
        content,
        // Optional per-message model choice; the service falls back to the
        // app default when these are absent.
        provider: typeof providerRaw === 'string' && providerRaw ? providerRaw : undefined,
        model: typeof modelRaw === 'string' && modelRaw ? modelRaw : undefined,
        // Optional per-request "bring your own key" from the request headers.
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

  // Delete a message and its entire subtree. The message id columns are text,
  // so the id is compared as-is.
  app.delete(
    '/messages/:id',
    wrap(async (req, res) => {
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
    })
  );
}
