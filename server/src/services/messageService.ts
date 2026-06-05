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
import { getProvider } from '../providers/index.js';
import type { LlmMessage } from '../providers/index.js';
// Re-exported from their new home (server/src/providers) so existing importers
// of these error types keep working unchanged after the provider refactor.
export { ApiRateLimitError, LlmTimeoutError } from '../providers/index.js';

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

// The LlmMessage shape (one conversation turn) now lives with the provider
// contract in server/src/providers, and is imported above. The error types
// (ApiRateLimitError / LlmTimeoutError) likewise moved there and are
// re-exported at the top of this file for backward compatibility.

// Public return type for `createMessageWithAutoReply`.
export interface CreatedMessagePair {
  userMessage: Message;
  assistantMessage: Message;
  lineage: LineageMessage[];
}

// Create a new user message, compute its lineage via recursive CTE,
// ask the configured LLM provider for a reply using only that pruned context,
// and store the assistant reply.
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

    // 4. Ask the configured LLM provider for a reply, using only the pruned
    //    context. Which provider answers (Groq, OpenAI, ...) is decided by the
    //    provider registry, not by this conversation logic.
    const assistantContent = await getProvider().complete(llmMessages);

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
