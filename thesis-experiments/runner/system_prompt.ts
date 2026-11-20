// The single system prompt used for every model and every condition.
// Neutral on purpose: it neither tells the model to ignore earlier branches nor
// to use everything it sees, so differences come from the context alone.
import { createHash } from 'node:crypto';

export const SYSTEM_PROMPT =
  'You are a helpful assistant for a software developer. ' +
  "Answer the user's latest message using the conversation so far. " +
  'Be concise and specific. When asked for a value, state it explicitly.';

export const SYSTEM_PROMPT_SHA256 = createHash('sha256').update(SYSTEM_PROMPT).digest('hex');
