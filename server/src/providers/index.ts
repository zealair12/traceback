// The provider registry and selector.
//
// Plain-English big picture:
// This is the "switchboard". It keeps a list of every LLM backend Traceback
// knows how to talk to, and hands the rest of the app whichever one it asks for
// (or the default). To add a new backend later you write one new file that
// fulfils the ChatProvider contract and add a single line to the registry below
// -- no changes anywhere else in the app. Which provider is used by default is
// controlled by the LLM_PROVIDER environment variable.

import type { ChatProvider } from './types.js';
import { ProviderNotAvailableError } from './types.js';
import { createGroqProvider } from './groqProvider.js';
import { createOpenAIProvider, createLocalProvider } from './openaiProvider.js';
import { createAnthropicProvider } from './anthropicProvider.js';

// Each entry maps a short id to a function that builds that provider on demand.
// Building lazily means a provider that needs a missing API key does not break
// the others just by being listed here. To add a new backend: write one file
// that fulfils the ChatProvider contract and add one line here.
const registry: Record<string, () => ChatProvider> = {
  groq: createGroqProvider,
  openai: createOpenAIProvider,
  anthropic: createAnthropicProvider,
  local: createLocalProvider,
};

// Cache built providers so we reuse one instance per id within the process.
const built = new Map<string, ChatProvider>();

// The provider used when a request does not name one. Defaults to Groq to keep
// existing setups working with no configuration change.
export function defaultProviderId(): string {
  return process.env.LLM_PROVIDER ?? 'groq';
}

// The list of ids the app currently knows about (for diagnostics / a future
// "which models can I pick" endpoint).
export function availableProviderIds(): string[] {
  return Object.keys(registry);
}

// Hand back a provider by id (or the default). Throws a clear error if the id
// is unknown, so a typo in configuration fails loudly instead of silently.
export function getProvider(id?: string): ChatProvider {
  const providerId = id ?? defaultProviderId();
  const cached = built.get(providerId);
  if (cached) return cached;

  const factory = registry[providerId];
  if (!factory) {
    throw new ProviderNotAvailableError(
      `Unknown LLM provider "${providerId}". Known providers: ${availableProviderIds().join(', ')}.`
    );
  }
  const provider = factory();
  built.set(providerId, provider);
  return provider;
}

export type { ChatProvider } from './types.js';
export { ApiRateLimitError, LlmTimeoutError, ProviderNotAvailableError } from './types.js';
export type { LlmMessage, CompletionOptions } from './types.js';
