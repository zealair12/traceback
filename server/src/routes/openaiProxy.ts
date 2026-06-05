// OpenAI-compatible proxy endpoint.
//
// Plain-English big picture:
// Many apps and tools already know how to talk to OpenAI's API. This endpoint
// speaks that same language at POST /v1/chat/completions, so such an app can
// point its "base URL" at Traceback and have its conversations flow through
// Traceback's branching-tree + context-pruning engine -- ideally with no code
// changes. It works two ways:
//   - Drop-in (default): send a normal OpenAI request; we store the conversation
//     as a tree and answer the last message. (For apps that resend the whole
//     history every call, the pruning benefit is limited -- the branch-aware
//     path below is where the real saving happens.)
//   - Branch-aware (opt-in): include a Traceback session_id (and optionally a
//     parent_id / branch_label) and we attach the new turn to that exact point
//     in the tree, forwarding only the pruned root-to-node lineage to the model.

import type { Express, Request, Response, NextFunction } from 'express';
import { prisma } from '../prismaClient.js';
import { createMessageWithAutoReply } from '../services/messageService.js';
import { getProvider, defaultProviderId } from '../providers/index.js';
import { resolveApiKey } from '../auth/apiKey.js';

type Role = 'user' | 'assistant' | 'system';
interface IncomingMessage {
  role: Role;
  content: string;
}

// Turn the OpenAI "model" field into a Traceback provider id + model name.
// "groq/llama-3.3-70b-versatile" -> { providerId: "groq", model: "llama-..." }
// "gpt-4o"                       -> { providerId: <default>, model: "gpt-4o" }
// missing                        -> { providerId: <default>, model: undefined }
function resolveModel(modelField: unknown): { providerId: string; model?: string } {
  if (typeof modelField !== 'string' || !modelField.trim()) {
    return { providerId: defaultProviderId() };
  }
  const slash = modelField.indexOf('/');
  if (slash > 0) {
    return {
      providerId: modelField.slice(0, slash),
      model: modelField.slice(slash + 1)
    };
  }
  return { providerId: defaultProviderId(), model: modelField };
}

export function registerOpenAiProxy(app: Express) {
  app.post('/v1/chat/completions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body ?? {};
      const {
        model: modelField,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream,
        // Traceback extension fields (optional; enable the branch-aware path).
        session_id: sessionIdRaw,
        parent_id: parentIdRaw
      } = body;

      // Streaming is not supported yet; fail clearly rather than hang.
      if (stream === true) {
        res.status(400).json({
          error: {
            message: 'Streaming responses are not supported yet by the Traceback proxy.',
            type: 'invalid_request_error'
          }
        });
        return;
      }

      // Validate the messages array and that it ends with a user turn.
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({
          error: { message: 'messages must be a non-empty array.', type: 'invalid_request_error' }
        });
        return;
      }
      const cleaned: IncomingMessage[] = [];
      for (const m of messages) {
        if (!m || typeof m.content !== 'string' || !['user', 'assistant', 'system'].includes(m.role)) {
          res.status(400).json({
            error: {
              message: 'each message needs a string content and a role of user, assistant, or system.',
              type: 'invalid_request_error'
            }
          });
          return;
        }
        cleaned.push({ role: m.role, content: m.content });
      }
      const last = cleaned[cleaned.length - 1];
      if (last.role !== 'user') {
        res.status(400).json({
          error: {
            message: 'the final message must be from the user (that is the turn to answer).',
            type: 'invalid_request_error'
          }
        });
        return;
      }

      const { providerId, model } = resolveModel(modelField);

      // Validate the provider up front so we never create half a tree for an
      // unknown backend. getProvider throws ProviderNotAvailableError (-> 400).
      getProvider(providerId);

      // Per-request "bring your own key" (Authorization: Bearer ... or
      // x-provider-key). Resolved before any writes so an insecure-transport
      // rejection happens before we create a session. Never stored or logged.
      const apiKey = resolveApiKey(req);

      const sessionId = typeof sessionIdRaw === 'string' && sessionIdRaw ? sessionIdRaw : null;
      const parentId = typeof parentIdRaw === 'string' && parentIdRaw ? parentIdRaw : null;

      let targetSessionId: string;
      let targetParentId: string | null;

      if (sessionId) {
        // Branch-aware: attach to the given session at the given point.
        targetSessionId = sessionId;
        targetParentId = parentId;
      } else {
        // Drop-in: create a fresh session and store every message before the
        // final user turn as the lineage leading up to it.
        const session = await prisma.session.create({ data: { name: null } });
        targetSessionId = session.id;

        let prevId: string | null = null;
        let depth = 0;
        for (let i = 0; i < cleaned.length - 1; i++) {
          const seeded: { id: string } = await prisma.message.create({
            data: {
              sessionId: session.id,
              parentId: prevId,
              role: cleaned[i].role,
              content: cleaned[i].content,
              depth
            }
          });
          prevId = seeded.id;
          depth += 1;
        }
        targetParentId = prevId;
      }

      // Answer the final user turn, going through the tree engine so the reply
      // is stored and only the pruned lineage is sent to the model.
      const result = await createMessageWithAutoReply({
        sessionId: targetSessionId,
        parentId: targetParentId,
        content: last.content,
        provider: providerId,
        model,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        maxTokens: typeof maxTokens === 'number' ? maxTokens : undefined,
        apiKey
      });

      // Respond in OpenAI's chat.completion shape, plus a small "traceback"
      // extension so branch-aware callers can continue the tree next time.
      res.status(200).json({
        id: 'chatcmpl-' + result.assistantMessage.id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: `${result.assistantMessage.provider ?? providerId}/${result.assistantMessage.model ?? model ?? ''}`,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: result.assistantMessage.content },
            finish_reason: 'stop'
          }
        ],
        // We do not compute token counts; reported as zero.
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        traceback: {
          session_id: targetSessionId,
          user_message_id: result.userMessage.id,
          assistant_message_id: result.assistantMessage.id
        }
      });
    } catch (error: unknown) {
      next(error);
    }
  });
}
