// OpenAI-compatible implementation of the ChatProvider contract.
//
// Plain-English big picture:
// A very large share of the LLM world speaks "the OpenAI dialect" -- not just
// OpenAI itself, but also tools you run on your own computer (Ollama, LM Studio)
// and many hosting services. They all accept the same request shape. So this one
// file is written generically: point it at a web address and give it a key, and
// it can talk to any of them. We then create two named plugins from it: "openai"
// (the real OpenAI service) and "local" (an OpenAI-compatible server you run
// yourself, e.g. Ollama).

import OpenAI from 'openai';
import type { ChatProvider, CompletionOptions, LlmMessage } from './types.js';
import { callWithRetry } from './retry.js';
import { toOpenAiDialectMessages } from './imageContent.js';

const DEFAULT_TIMEOUT_MS = 60_000;

// Settings that distinguish one OpenAI-compatible backend from another.
interface OpenAICompatibleConfig {
  // Short name used to select this plugin (e.g. "openai", "local").
  id: string;
  // Model used when the caller does not name one.
  defaultModel: string;
  // Curated model names a picker UI can offer.
  suggestedModels: string[];
  // Which of those models accept images.
  visionModels: string[];
  // Which of those models accept document (PDF) attachments.
  documentModels: string[];
  // Name of the environment variable that holds the API key.
  apiKeyEnv: string;
  // Optional fixed base web address (used for local servers like Ollama).
  baseURLEnv?: string;
  defaultBaseURL?: string;
  // If true, the backend works without a key (typical for local servers).
  keyOptional?: boolean;
}

function buildOpenAICompatibleProvider(config: OpenAICompatibleConfig): ChatProvider {
  const resolveBaseURL = () =>
    (config.baseURLEnv ? process.env[config.baseURLEnv] : undefined) ?? config.defaultBaseURL;

  return {
    id: config.id,
    defaultModel: config.defaultModel,
    suggestedModels: config.suggestedModels,
    visionModels: config.visionModels,
    documentModels: config.documentModels,

    isConfigured() {
      if (config.keyOptional) return true; // local servers usually need no key
      return Boolean(process.env[config.apiKeyEnv]);
    },

    async complete(messages: LlmMessage[], options?: CompletionOptions): Promise<string> {
      if (messages.length === 0) return 'No prior context was provided.';

      // A caller-supplied key (bring-your-own-key) wins over the server env key.
      const apiKey = options?.apiKey ?? process.env[config.apiKeyEnv];
      if (!apiKey && !config.keyOptional) {
        throw new Error(`No API key for "${config.id}": set ${config.apiKeyEnv} or supply your own key.`);
      }

      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const model = options?.model ?? config.defaultModel;
      const client = new OpenAI({
        // Local servers accept any non-empty key; send a placeholder if absent.
        apiKey: apiKey ?? 'not-needed',
        baseURL: resolveBaseURL(),
        timeout: timeoutMs,
      });

      return callWithRetry<string>(
        async () => {
          const completion = await client.chat.completions.create({
            model,
            // Image turns become content-parts lists; text turns stay strings.
            messages: toOpenAiDialectMessages(messages) as never,
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {})
          });
          return (
            completion.choices?.[0]?.message?.content ??
            'The model did not return any content.'
          );
        },
        { timeoutMs, label: config.id }
      );
    },
  };
}

// The real OpenAI service.
export function createOpenAIProvider(): ChatProvider {
  return buildOpenAICompatibleProvider({
    id: 'openai',
    defaultModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'o4-mini'],
    visionModels: ['gpt-4o-mini', 'gpt-4o'],
    documentModels: ['gpt-4o-mini', 'gpt-4o'],
    apiKeyEnv: 'OPENAI_API_KEY',
    baseURLEnv: 'OPENAI_BASE_URL',
  });
}

// A local / self-hosted OpenAI-compatible server (Ollama by default).
export function createLocalProvider(): ChatProvider {
  return buildOpenAICompatibleProvider({
    id: 'local',
    defaultModel: process.env.LOCAL_MODEL ?? 'llama3.1',
    suggestedModels: ['llama3.1', 'llama3.2', 'qwen2.5', 'mistral'],
    // Local servers vary; name your image-capable models (e.g. llava) here.
    visionModels: (process.env.LOCAL_VISION_MODELS ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    // Local servers vary; name your document-capable models here if any.
    documentModels: (process.env.LOCAL_DOCUMENT_MODELS ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    apiKeyEnv: 'LOCAL_API_KEY',
    baseURLEnv: 'LOCAL_BASE_URL',
    defaultBaseURL: 'http://localhost:11434/v1', // Ollama's default address
    keyOptional: true,
  });
}
