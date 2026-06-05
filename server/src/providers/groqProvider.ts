// Groq implementation of the ChatProvider contract.
//
// Plain-English big picture:
// This is the very first "plugin" behind the neutral provider contract. It is
// the same Groq logic the app always used, just moved behind the shared
// interface so it sits alongside future providers (OpenAI, Anthropic, local)
// as an equal, swappable option. Behaviour for existing Groq users is unchanged.

import Groq from 'groq-sdk';
import type { ChatProvider, CompletionOptions, LlmMessage } from './types.js';
import { callWithRetry } from './retry.js';

const DEFAULT_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
const DEFAULT_TIMEOUT_MS = 30_000;

export function createGroqProvider(): ChatProvider {
  return {
    id: 'groq',
    defaultModel: DEFAULT_MODEL,

    // Configured simply means: do we have the API key Groq requires.
    isConfigured() {
      return Boolean(process.env.GROQ_API_KEY);
    },

    async complete(messages: LlmMessage[], options?: CompletionOptions): Promise<string> {
      if (messages.length === 0) return 'No prior context was provided.';

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured in the environment.');
      }

      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const model = options?.model ?? DEFAULT_MODEL;
      const groq = new Groq({ apiKey, timeout: timeoutMs });

      return callWithRetry<string>(
        async () => {
          const completion = await groq.chat.completions.create({ messages, model });
          return (
            completion.choices?.[0]?.message?.content ??
            'The model did not return any content.'
          );
        },
        { timeoutMs, label: 'Groq' }
      );
    },
  };
}
