// The "contract" every LLM backend must fulfil.
//
// Plain-English big picture:
// Traceback's job is to take a pruned conversation (the path from the root of
// the tree down to where you are) and ask a language model to continue it.
// Originally that model was hard-wired to one company (Groq). This file defines
// a neutral contract -- a list of things ANY model backend must be able to do --
// so that Groq, OpenAI, Anthropic, a local model, etc. all become interchangeable
// plugins. The rest of the app talks to "a provider" through this contract and
// never needs to know which company is actually answering.

// A single turn in a conversation, in the shape every major LLM API expects.
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Knobs the caller can pass for a single completion request.
export interface CompletionOptions {
  // Which specific model to use (e.g. "llama-3.3-70b-versatile", "gpt-4o").
  // If omitted, the provider falls back to its own default model.
  model?: string;
  // Hard time budget for the whole request, in milliseconds.
  timeoutMs?: number;
}

// The contract itself. A "provider" is one company's/back-end's implementation.
export interface ChatProvider {
  // Stable short name used to select this provider (e.g. "groq", "openai").
  readonly id: string;
  // The model this provider uses when the caller does not name one.
  readonly defaultModel: string;
  // Whether the necessary configuration (usually an API key) is present.
  // Lets the app fail early with a clear message instead of mid-request.
  isConfigured(): boolean;
  // Take the pruned conversation and return the model's reply as plain text.
  complete(messages: LlmMessage[], options?: CompletionOptions): Promise<string>;
}

// --- Shared error types -----------------------------------------------------
// Every provider maps its own SDK's errors onto these two shared types, so the
// HTTP layer can react the same way no matter which backend was used.

// The provider told us we are sending requests too fast (HTTP 429).
export class ApiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiRateLimitError';
  }
}

// The provider took too long and we gave up waiting.
export class LlmTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmTimeoutError';
  }
}

// Raised when someone asks for a provider that is not registered or not
// configured, so the caller gets a clear, actionable message.
export class ProviderNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotAvailableError';
  }
}
