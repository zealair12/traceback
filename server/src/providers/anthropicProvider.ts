// Anthropic (Claude) implementation of the ChatProvider contract.
//
// Plain-English big picture:
// Anthropic's API is shaped slightly differently from the others: the "system"
// instruction is passed as its own separate field rather than as a message in
// the list, and you must state an upper limit on how long the reply can be.
// This file translates Traceback's neutral message list into that shape, so
// from the rest of the app's point of view Claude is just another swappable
// plugin like any other.

import Anthropic from '@anthropic-ai/sdk';
import type { ChatProvider, CompletionOptions, LlmMessage } from './types.js';
import { callWithRetry } from './retry.js';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-latest';
const DEFAULT_TIMEOUT_MS = 60_000;
// Upper bound on reply length. Overridable via ANTHROPIC_MAX_TOKENS.
const DEFAULT_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 1024);

export function createAnthropicProvider(): ChatProvider {
  return {
    id: 'anthropic',
    defaultModel: DEFAULT_MODEL,
    suggestedModels: [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-opus-latest',
    ],

    isConfigured() {
      return Boolean(process.env.ANTHROPIC_API_KEY);
    },

    async complete(messages: LlmMessage[], options?: CompletionOptions): Promise<string> {
      if (messages.length === 0) return 'No prior context was provided.';

      // A caller-supplied key (bring-your-own-key) wins over the server env key.
      const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('No Anthropic API key: set ANTHROPIC_API_KEY or supply your own key.');
      }

      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const model = options?.model ?? DEFAULT_MODEL;

      // Split the neutral message list into Anthropic's shape:
      // - all "system" turns are merged into the separate system instruction
      // - the rest become the user/assistant conversation
      const systemPrompt = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const conversation = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const client = new Anthropic({ apiKey, timeout: timeoutMs });

      return callWithRetry<string>(
        async () => {
          const response = await client.messages.create({
            model,
            // Anthropic always requires a reply-length cap; the caller can
            // override the default via maxTokens.
            max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
            system: systemPrompt || undefined,
            messages: conversation,
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {})
          });
          // Anthropic returns a list of content blocks; collect the text ones.
          const text = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('');
          return text || 'The model did not return any content.';
        },
        { timeoutMs, label: 'Anthropic' }
      );
    },
  };
}
