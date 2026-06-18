// The shared backbone every LLM backend inherits.
//
// Plain-English big picture:
// Every backend used to repeat the same plumbing: guard against empty
// conversations, resolve which API key to use (the caller's own key beats the
// server's), apply a time budget, and wrap the network call in the shared
// retry strategy. This base class does all of that once. A concrete backend
// only describes itself (its traits: name, models, where its key lives) and
// implements one method -- performRequest -- that speaks its wire format.

import type { ChatProvider, CompletionOptions, LlmMessage } from './types.js';
import { callWithRetry } from './retry.js';

// Everything that distinguishes one backend, as plain data.
export interface ProviderTraits {
  id: string;
  defaultModel: string;
  suggestedModels: string[];
  visionModels: string[];
  documentModels: string[];
  // Name of the environment variable holding this backend's key.
  apiKeyEnv: string;
  // True for backends that work without a key (local servers).
  keyOptional?: boolean;
  // Per-request time budget; backends can be slower or faster by nature.
  timeoutMs?: number;
}

// What performRequest receives: the resolved, ready-to-send request.
export interface ProviderRequest {
  messages: LlmMessage[];
  model: string;
  apiKey?: string;
  timeoutMs: number;
  options?: CompletionOptions;
}

export abstract class BaseChatProvider implements ChatProvider {
  readonly id: string;
  readonly defaultModel: string;
  readonly suggestedModels: string[];
  readonly visionModels: string[];
  readonly documentModels: string[];
  protected readonly apiKeyEnv: string;
  protected readonly keyOptional: boolean;
  protected readonly timeoutMs: number;

  constructor(traits: ProviderTraits) {
    this.id = traits.id;
    this.defaultModel = traits.defaultModel;
    this.suggestedModels = traits.suggestedModels;
    this.visionModels = traits.visionModels;
    this.documentModels = traits.documentModels;
    this.apiKeyEnv = traits.apiKeyEnv;
    this.keyOptional = traits.keyOptional ?? false;
    this.timeoutMs = traits.timeoutMs ?? 60_000;
  }

  isConfigured(): boolean {
    return this.keyOptional || Boolean(process.env[this.apiKeyEnv]);
  }

  // The template every completion follows; subclasses only do the wire call.
  async complete(messages: LlmMessage[], options?: CompletionOptions): Promise<string> {
    if (messages.length === 0) return 'No prior context was provided.';

    // A caller-supplied key (bring-your-own-key) wins over the server env key.
    const apiKey = options?.apiKey ?? process.env[this.apiKeyEnv];
    if (!apiKey && !this.keyOptional) {
      throw new Error(`No API key for "${this.id}": set ${this.apiKeyEnv} or supply your own key.`);
    }

    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const model = options?.model ?? this.defaultModel;

    // Strip attachments the chosen model can't process. Rather than letting an
    // unsupported attachment cause a malformed API request, we remove it and
    // leave a plain-text note so the model (and user) know what was there.
    const canSeeImages = this.visionModels.includes(model);
    const canReadFiles = this.documentModels.includes(model);
    const preparedMessages: LlmMessage[] = messages.map((m) => {
      const hasImages = (m.images?.length ?? 0) > 0;
      const hasFiles = (m.files?.length ?? 0) > 0;
      if (!hasImages && !hasFiles) return m;
      const notes: string[] = [];
      if (hasImages && !canSeeImages) notes.push('[Image attached — switch to Auto, gpt-4o, or claude to analyse it]');
      if (hasFiles && !canReadFiles) notes.push('[Document attached — switch to gpt-4o or claude to read it]');
      return {
        role: m.role,
        content: notes.length > 0
          ? (m.content ? m.content + '\n' : '') + notes.join('\n')
          : m.content,
        images: canSeeImages ? m.images : undefined,
        files: canReadFiles ? m.files : undefined,
      };
    });

    return callWithRetry<string>(
      () => this.performRequest({ messages: preparedMessages, model, apiKey, timeoutMs, options }),
      { timeoutMs, label: this.id }
    );
  }

  protected abstract performRequest(request: ProviderRequest): Promise<string>;
}
