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
import type { LlmMessage, ImageAttachment } from '../providers/index.js';
import { HUMANIZE_WRITING_PROMPT } from '../prompts/humanizeWriting.js';
import { TRACEBACK_FEATURES } from '../prompts/features.js';
// Re-exported from their new home (server/src/providers) so existing importers
// of these error types keep working unchanged after the provider refactor.
export { ApiRateLimitError, LlmTimeoutError } from '../providers/index.js';

// Hard limit on how deep a conversation tree can go.
// This is enforced at the application layer before we insert
// a new message, using the parent's depth.
// Raised from 32: imported histories (e.g. long ChatGPT conversations) can be
// hundreds of turns deep, and users must be able to continue them here. The
// recursive lineage query handles any depth; this is just a runaway guard.
export const MAX_DEPTH = 1024;

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
  attachments: ImageAttachment[] | null;
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
  // Optional per-message choice of which backend and model should answer.
  // When omitted, the app's default provider and that provider's default
  // model are used. This is what makes the Cursor-style "pick any LLM"
  // experience possible -- each message can be answered by a different model.
  provider?: string;
  model?: string;
  // Optional sampling controls, passed through to the backend. Used by the
  // OpenAI-compatible proxy, which forwards temperature / max_tokens.
  temperature?: number;
  maxTokens?: number;
  // Optional caller-supplied API key (bring-your-own-key). Used for this request
  // only and never stored or logged.
  apiKey?: string;
  // Optional images attached to the user's message. Stored with the message
  // and shown to image-capable models alongside the text.
  attachments?: ImageAttachment[];
}): Promise<CreatedMessagePair> {
  const { sessionId, parentId, content, provider, model, temperature, maxTokens, apiKey, attachments } = options;

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

  // Write the user message and read its lineage in ONE SHORT transaction, then
  // call the LLM OUTSIDE any transaction. Holding a DB connection open for the
  // (slow) model round-trip was the connection-pool-exhaustion risk under load.
  const { userMessage, lineage } = await prisma.$transaction(async (tx) => {
    // 1. Create the user message node.
    const userMessage = await tx.message.create({
      data: {
        sessionId,
        parentId,
        role: 'user',
        content,
        depth,
        ...(attachments && attachments.length > 0
          ? { attachments: attachments as unknown as Prisma.InputJsonValue }
          : {})
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
          m.attachments,
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
          parent.attachments,
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

    return { userMessage, lineage };
  });

  // 3. Build the pruned context for the model from the lineage we just read.
  const llmMessages: LlmMessage[] = [
      {
        role: 'system',
        content:
          // Identity + what it does, so it can answer "who made you?" AND
          // "what do you do / how are you different?". It presents as TraceBack,
          // made by Zeal, and does not reveal the underlying model/provider.
          // (Models can still occasionally slip, but a firm instruction handles
          // the common case.)
          'You are TraceBack, a branching AI chat assistant made by Zeal. ' +
          'Answer the user\'s actual message and nothing more. Do NOT introduce yourself, describe your features, or mention your creator unless the user explicitly asks about them. ' +
          'Only if the user asks what you do or how you differ: TraceBack lets people branch any reply into a new direction, so a conversation grows as an explorable tree instead of one straight thread; it sends the model only the path from the start of the chat to the current message, which keeps answers focused and uses fewer tokens; and it can answer with different models per branch or use a person\'s own API key. That design sets it apart from linear, single-model assistants like ChatGPT or Claude. ' +
          'Only if asked who made or created you: say you were made by Zeal, and if they want more about Zeal you may share these markdown links: [LinkedIn](https://www.linkedin.com/in/okechukwuzealachonu/) and [GitHub](https://github.com/zealair12). Never volunteer the links. If asked what model you are or which company built you, say you are TraceBack and do not name or reveal the underlying model or provider.\n\n' +
          // Honesty about web access, so it never claims to browse and then backtracks.
          'You cannot open links, browse the web, or read external websites or repositories on your own. Sometimes web search results are added to your context automatically; when they are present, use them for current facts and cite each source as a full markdown link in the form [name](https://full-url) using its real URL. Never write a source as bare bracketed text such as [example.com] with no link. When they are not present, answer from your own knowledge, and if the user needs live information you do not have, say so plainly. Never tell the user you can access a site or repository and then say you cannot: be consistent in a single answer.\n\n' +
          // Feature knowledge (single source of truth in prompts/features.ts).
          'Use the following ONLY to answer questions about what you can do or how to do something. Never bring it up unprompted:\n' +
          TRACEBACK_FEATURES + '\n\n' +
          'Be concise and direct. Keep answers under 4 sentences unless the user asks for detail. ' +
          'Use markdown for formatting. For math, use LaTeX with $...$ for inline and $$...$$ for display equations.\n\n' +
          // Every reply passes through the anti-trope guide so the writing
          // reads like a person, whichever provider answers.
          HUMANIZE_WRITING_PROMPT
      },
      ...lineage.map((m) => {
        // Anything attached along the path travels with its turn: images for
        // models that can see, documents for models that can read PDFs.
        const images = (m.attachments ?? []).filter((a) => a.type === 'image');
        const files = (m.attachments ?? []).filter((a) => a.type === 'file');
        return {
          role: m.role,
          content: m.content,
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {})
        };
      })
    ];

  // 4. Ask the chosen LLM provider for a reply, using only the pruned context.
  //    This runs OUTSIDE any transaction, so no DB connection is held during the
  //    model round-trip. If the call fails, delete the user message we wrote so a
  //    failed turn leaves no half-written trace (preserving the old all-or-nothing
  //    behavior without pinning a connection for seconds).
  const chosenProvider = getProvider(provider);
  // Record exactly which backend and model were used, even when the request left
  // them unset, so the UI can show "answered by X" on each tree node.
  const usedModel = model ?? chosenProvider.defaultModel;
  let assistantContent: string;
  try {
    assistantContent = await chosenProvider.complete(llmMessages, {
      model,
      temperature,
      maxTokens,
      apiKey
    });
  } catch (err) {
    await prisma.message.delete({ where: { id: userMessage.id } }).catch(() => {});
    throw err;
  }

  // 5. Store the assistant reply as a child of the user message.
  const assistantMessage = await prisma.message.create({
    data: {
      sessionId,
      parentId: userMessage.id,
      role: 'assistant',
      content: assistantContent,
      provider: chosenProvider.id,
      model: usedModel,
      depth: userMessage.depth + 1
    }
  });

  return {
    userMessage,
    assistantMessage,
    lineage
  };
}
