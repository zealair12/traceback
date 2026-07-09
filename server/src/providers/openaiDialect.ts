// One class for every backend that speaks the OpenAI dialect.
//
// Plain-English big picture:
// Most of the LLM world accepts the same request shape: OpenAI itself, Groq
// (whose API is OpenAI-compatible at api.groq.com/openai/v1), and local
// servers like Ollama or LM Studio. So instead of one file per company, this
// is one class configured three ways. Adding another OpenAI-compatible
// backend later is a new traits object, not new code.

import OpenAI from 'openai';
import { BaseChatProvider, type ProviderTraits, type ProviderRequest } from './base.js';
import type { ChatProvider, CompletionOptions, LlmMessage } from './types.js';
import { toOpenAiDialectMessages } from './imageContent.js';

interface DialectTraits extends ProviderTraits {
  // Where this backend lives; the env variable (when set) wins.
  baseURLEnv?: string;
  defaultBaseURL?: string;
  // False for backends whose chat API rejects document (PDF) parts.
  supportsFiles?: boolean;
}

export class OpenAIDialectProvider extends BaseChatProvider {
  constructor(private readonly dialect: DialectTraits) {
    super(dialect);
  }

  protected async performRequest({ messages, model, apiKey, timeoutMs, options }: ProviderRequest): Promise<string> {
    const client = new OpenAI({
      // Local servers accept any non-empty key; send a placeholder if absent.
      apiKey: apiKey ?? 'not-needed',
      baseURL:
        (this.dialect.baseURLEnv ? process.env[this.dialect.baseURLEnv] : undefined) ??
        this.dialect.defaultBaseURL,
      timeout: timeoutMs
    });
    const completion = await client.chat.completions.create({
      model,
      // Turns with images/documents become content-parts lists; text turns
      // stay plain strings.
      messages: toOpenAiDialectMessages(messages, {
        supportsFiles: this.dialect.supportsFiles !== false
      }) as never,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {})
    });
    return completion.choices?.[0]?.message?.content ?? 'The model did not return any content.';
  }

  // Streaming variant: emit each token as it arrives, return the full text.
  // Streaming and automatic retry don't mix cleanly, so this path does not
  // retry — a failed stream surfaces to the caller (which falls back).
  async completeStream(
    messages: LlmMessage[],
    options: CompletionOptions | undefined,
    onToken: (chunk: string) => void
  ): Promise<string> {
    if (messages.length === 0) {
      const t = 'No prior context was provided.';
      onToken(t);
      return t;
    }
    const req = this.buildRequest(messages, options);
    const client = new OpenAI({
      apiKey: req.apiKey ?? 'not-needed',
      baseURL:
        (this.dialect.baseURLEnv ? process.env[this.dialect.baseURLEnv] : undefined) ??
        this.dialect.defaultBaseURL,
      timeout: req.timeoutMs
    });
    const stream = await client.chat.completions.create({
      model: req.model,
      messages: toOpenAiDialectMessages(req.messages, {
        supportsFiles: this.dialect.supportsFiles !== false
      }) as never,
      stream: true,
      ...(req.options?.temperature !== undefined ? { temperature: req.options.temperature } : {}),
      ...(req.options?.maxTokens !== undefined ? { max_tokens: req.options.maxTokens } : {})
    });
    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onToken(delta);
      }
    }
    return full || 'The model did not return any content.';
  }
}

// Groq: OpenAI-compatible API, fast models, no document support.
export const createGroqProvider = (): ChatProvider =>
  new OpenAIDialectProvider({
    id: 'groq',
    defaultModel: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    suggestedModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'mixtral-8x7b-32768'
    ],
    visionModels: [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct'
    ],
    documentModels: [],
    apiKeyEnv: 'GROQ_API_KEY',
    baseURLEnv: 'GROQ_BASE_URL',
    defaultBaseURL: 'https://api.groq.com/openai/v1',
    supportsFiles: false,
    timeoutMs: 30_000
  });

// Perplexity: OpenAI-compatible, models are search-augmented (sonar family).
export const createPerplexityProvider = (): ChatProvider =>
  new OpenAIDialectProvider({
    id: 'perplexity',
    defaultModel: 'llama-3.1-sonar-small-128k-online',
    suggestedModels: [
      'llama-3.1-sonar-small-128k-online',
      'llama-3.1-sonar-large-128k-online',
      'llama-3.1-sonar-huge-128k-online'
    ],
    visionModels: [],
    documentModels: [],
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    defaultBaseURL: 'https://api.perplexity.ai',
    supportsFiles: false,
    timeoutMs: 30_000
  });

// The real OpenAI service.
export const createOpenAIProvider = (): ChatProvider =>
  new OpenAIDialectProvider({
    id: 'openai',
    defaultModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'o4-mini'],
    // Which model ids can see images / read documents. Defaults to OpenAI's,
    // but overridable by env so an OpenAI-compatible router (OpenRouter, etc.)
    // can name its own vision/document model ids and have attachments sent
    // through instead of being stripped.
    visionModels: (process.env.OPENAI_VISION_MODELS ?? 'gpt-4o-mini,gpt-4o')
      .split(',').map((m) => m.trim()).filter(Boolean),
    documentModels: (process.env.OPENAI_DOCUMENT_MODELS ?? 'gpt-4o-mini,gpt-4o')
      .split(',').map((m) => m.trim()).filter(Boolean),
    apiKeyEnv: 'OPENAI_API_KEY',
    baseURLEnv: 'OPENAI_BASE_URL'
  });

// A local / self-hosted OpenAI-compatible server (Ollama by default). Name
// your image/document-capable models via env since local setups vary.
export const createLocalProvider = (): ChatProvider =>
  new OpenAIDialectProvider({
    id: 'local',
    defaultModel: process.env.LOCAL_MODEL ?? 'llama3.1',
    suggestedModels: ['llama3.1', 'llama3.2', 'qwen2.5', 'mistral'],
    visionModels: (process.env.LOCAL_VISION_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean),
    documentModels: (process.env.LOCAL_DOCUMENT_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean),
    apiKeyEnv: 'LOCAL_API_KEY',
    baseURLEnv: 'LOCAL_BASE_URL',
    defaultBaseURL: 'http://localhost:11434/v1',
    keyOptional: true
  });
