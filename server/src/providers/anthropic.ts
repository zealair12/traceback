// Anthropic (Claude) backend.
//
// Plain-English big picture:
// Anthropic's API is shaped differently from the OpenAI dialect: the system
// instruction travels as its own field, a reply-length cap is mandatory, and
// images/PDFs are "source blocks" carrying raw base64. This subclass only
// does that translation; all the shared plumbing (key resolution, guards,
// retries, timeouts) lives in the base class.

import Anthropic from '@anthropic-ai/sdk';
import { BaseChatProvider, type ProviderRequest } from './base.js';
import type { ChatProvider } from './types.js';

// Upper bound on reply length. Overridable via ANTHROPIC_MAX_TOKENS.
const DEFAULT_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 1024);

const CLAUDE_MODELS = [
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-opus-latest'
];

export class AnthropicProvider extends BaseChatProvider {
  constructor() {
    super({
      id: 'anthropic',
      defaultModel: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-latest',
      suggestedModels: CLAUDE_MODELS,
      // Every current Claude chat model accepts images and reads PDFs.
      visionModels: CLAUDE_MODELS,
      documentModels: CLAUDE_MODELS,
      apiKeyEnv: 'ANTHROPIC_API_KEY'
    });
  }

  protected async performRequest({ messages, model, apiKey, timeoutMs, options }: ProviderRequest): Promise<string> {
    // System turns merge into the separate system field; the rest become the
    // user/assistant conversation. Turns with attachments become content
    // blocks (raw base64, so the data URL prefix is stripped).
    const systemPrompt = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content:
          (m.images?.length ?? 0) > 0 || (m.files?.length ?? 0) > 0
            ? ([
                ...(m.files ?? []).map((f) => ({
                  type: 'document' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: 'application/pdf' as const,
                    data: f.dataUrl.replace(/^data:[^;]+;base64,/, '')
                  }
                })),
                ...(m.images ?? []).map((img) => ({
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: img.mediaType as 'image/png',
                    data: img.dataUrl.replace(/^data:[^;]+;base64,/, '')
                  }
                })),
                { type: 'text' as const, text: m.content }
              ] as Anthropic.MessageParam['content'])
            : m.content
      }));

    const client = new Anthropic({ apiKey, timeout: timeoutMs });
    const response = await client.messages.create({
      model,
      // Anthropic always requires a reply-length cap.
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      // The system prompt is identical on every request, so mark it with
      // cache_control: Anthropic then re-reads it from its short-lived cache
      // at ~10% of the normal input price instead of reprocessing it each turn.
      system: systemPrompt
        ? [
            // cache_control is a prompt-caching extension; cast to bypass the
            // SDK's type definition which may not yet include it.
            {
              type: 'text' as const,
              text: systemPrompt,
              cache_control: { type: 'ephemeral' }
            } as Anthropic.TextBlockParam
          ]
        : undefined,
      messages: conversation,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {})
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return text || 'The model did not return any content.';
  }
}

export const createAnthropicProvider = (): ChatProvider => new AnthropicProvider();
