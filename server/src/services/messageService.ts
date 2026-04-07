// Message service layer.
// This file encapsulates all business logic for creating messages
// and reading conversation context from the database.
//
// The Express route handlers use these functions to keep HTTP
// concerns (request/response) separate from database concerns.
//
// CRITICAL: Prisma does not support recursive CTEs in its query
// builder, so we rely on `prisma.$queryRaw` with a recursive CTE
// to fetch the minimal, pruned lineage for any message.

import { prisma } from '../prismaClient.js';
import type { Role, Message } from '@prisma/client';
import { Prisma } from '@prisma/client';
import Groq from 'groq-sdk';
import retry from 'async-retry';

// Hard limit on how deep a conversation tree can go.
// This is enforced at the application layer before we insert
// a new message, using the parent's depth.
export const MAX_DEPTH = 32;

// Shape of a single lineage item returned by the recursive CTE.
// This mirrors the `messages` table but only includes fields
// we care about for building the LLM context.
export interface LineageMessage {
  id: string;
  session_id: string;
  parent_id: string | null;
  role: Role;
  content: string;
  depth: number;
  branch_label: string | null;
  created_at: Date;
}

// Shape used when sending context to the Groq API.
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Public return type for `createMessageWithAutoReply`.
export interface CreatedMessagePair {
  userMessage: Message;
  assistantMessage: Message;
  lineage: LineageMessage[];
}

// --- Error types ------------------------------------------------------------

// These custom error classes allow the Express layer to distinguish
// between different failure modes when logging and responding.
export class ApiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiRateLimitError';
  }
}

export class LlmTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmTimeoutError';
  }
}

// Create a new user message, compute its lineage via recursive CTE,
// call the Groq API with the pruned context, and store the assistant reply.
//
// This is the core of the "send message" flow used by the Express route.
export async function createMessageWithAutoReply(options: {
  sessionId: string;
  parentId: string | null;
  content: string;
}): Promise<CreatedMessagePair> {
  const { sessionId, parentId, content } = options;

  // Fetch parent (if any) to derive the new depth and to validate
  // that we are not creating an orphaned node.
  let depth = 0;
  if (parentId) {
    const parent = await prisma.message.findUnique({
      where: { id: parentId },
      select: { id: true, depth: true, sessionId: true }
    });

    if (!parent) {
      throw new Error('Parent message not found – cannot create orphaned node.');
    }
    if (parent.sessionId !== sessionId) {
      throw new Error('Parent and child must belong to the same session.');
    }

    depth = parent.depth + 1;
    if (depth > MAX_DEPTH) {
      throw new Error(`Maximum depth of ${MAX_DEPTH} exceeded.`);
    }
  }

  // All DB operations + lineage + assistant reply creation happen
  // in a single transaction so we never end up with half-written data.
  return prisma.$transaction(async (tx) => {
    // 1. Create the user message node.
    const userMessage = await tx.message.create({
      data: {
        sessionId,
        parentId,
        role: 'user',
        content,
        depth
      }
    });

    // 2. Compute lineage from root -> this new user message
    // using a recursive CTE. We intentionally use raw SQL here
    // because Prisma's query builder does not support recursive CTEs.
    const lineage = (await tx.$queryRaw<LineageMessage[]>(Prisma.sql`
      WITH RECURSIVE message_tree AS (
        -- Base case: start from the current message
        SELECT
          m.id,
          m.session_id,
          m.parent_id,
          m.role,
          m.content,
          m.depth,
          m.branch_label,
          m.created_at
        FROM messages m
        WHERE m.id = ${userMessage.id}

        UNION ALL

        -- Recursive case: walk "up" the tree by following parents
        SELECT
          parent.id,
          parent.session_id,
          parent.parent_id,
          parent.role,
          parent.content,
          parent.depth,
          parent.branch_label,
          parent.created_at
        FROM messages parent
        INNER JOIN message_tree mt ON parent.id = mt.parent_id
      )
      -- At this point we have a set of nodes from the current
      -- message back to the root, but in reverse order
      -- (current -> parent -> grandparent ...).
      -- We reorder by depth ascending so we get root -> leaf.
      SELECT *
      FROM message_tree
      ORDER BY depth ASC;
    `)) as LineageMessage[];

    const llmMessages: LlmMessage[] = [
      {
        role: 'system',
        content:
          'Be concise and direct. Keep answers under 4 sentences unless the user asks for detail. ' +
          'Use markdown for formatting. For math, use LaTeX with $...$ for inline and $$...$$ for display equations.'
      },
      ...lineage.map((m) => ({ role: m.role, content: m.content }))
    ];

    // 4. Call Groq with the pruned context.
    const assistantContent = await callGroqWithContext(llmMessages);

    // 5. Store assistant reply as a child of the user message.
    const assistantMessage = await tx.message.create({
      data: {
        sessionId,
        parentId: userMessage.id,
        role: 'assistant',
        content: assistantContent,
        depth: userMessage.depth + 1
      }
    });

    return {
      userMessage,
      assistantMessage,
      lineage
    };
  });
}

// --- Groq API integration ---------------------------------------------------

async function callGroqWithContext(messages: LlmMessage[]): Promise<string> {
  // Basic guard to avoid accidental huge prompts.
  if (messages.length === 0) {
    return 'No prior context was provided.';
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured in the environment.');
  }

  const groq = new Groq({ apiKey, timeout: 30_000 });

  // Helper to perform one Groq call with a hard timeout wrapper.
  const performRequest = async () => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new LlmTimeoutError('LLM call exceeded 30s timeout.')), 30_000);
    });

    const completionPromise = groq.chat.completions.create({
      messages,
      model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'
    });

    const completion = await Promise.race([completionPromise, timeoutPromise]);

    return (
      completion.choices?.[0]?.message?.content ??
      'The model did not return any content.'
    );
  };

  // Wrap the Groq call in an exponential backoff retry strategy.
  try {
    const result = await retry<string>(
      async (bail, attempt) => {
        try {
          return await performRequest();
        } catch (err: any) {
          const statusCode: number | undefined =
            err?.status ?? err?.statusCode ?? err?.response?.status;

          // 429: API rate limit — log and retry.
          if (statusCode === 429) {
            // eslint-disable-next-line no-console
            console.error(
              `[Groq] API rate limit encountered on attempt ${attempt}.`,
              err
            );
            throw new ApiRateLimitError('Groq API rate limit (HTTP 429).');
          }

          // Non-retryable DB / validation / other errors: bail out immediately.
          if (statusCode && statusCode < 500) {
            bail(err);
            return 'unreachable';
          }

          // For network / 5xx errors, allow retry.
          throw err;
        }
      },
      {
        retries: 3,
        minTimeout: 500,
        maxTimeout: 4_000,
        factor: 2
      }
    );

    return result;
  } catch (err: unknown) {
    // Final logging hook with clear categorization for operators.
    if (err instanceof LlmTimeoutError) {
      // eslint-disable-next-line no-console
      console.error('[LLM Timeout]', err.message);
    } else if (err instanceof ApiRateLimitError) {
      // eslint-disable-next-line no-console
      console.error('[API Rate Limit]', err.message);
    } else {
      // eslint-disable-next-line no-console
      console.error('[Groq API Error]', err);
    }
    throw err;
  }
}

