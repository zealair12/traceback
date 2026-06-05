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
    suggestedModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
    ],

    // Configured simply means: do we have the API key Groq requires.
    isConfigured() {
      return Boolean(process.env.GROQ_API_KEY);
    },

    async complete(messages: LlmMessage[], options?: CompletionOptions): Promise<string> {
      if (messages.length === 0) return 'No prior context was provided.';

      // A caller-supplied key (bring-your-own-key) wins over the server env key.
      const apiKey = options?.apiKey ?? process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error('No Groq API key: set GROQ_API_KEY or supply your own key.');
      }

      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const model = options?.model ?? DEFAULT_MODEL;
      const groq = new Groq({ apiKey, timeout: timeoutMs });

      return callWithRetry<string>(
        async () => {
          const completion = await groq.chat.completions.create({
            messages,
            model,
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {})
          });
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
