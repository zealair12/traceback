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

// One thing attached to a turn -- an image or a document (PDF) -- with the
// bytes as a base64 data URL. (The name is kept from its image-only days; it
// now covers files too.)
export interface ImageAttachment {
  type: 'image' | 'file';
  mediaType: string;
  dataUrl: string;
  name?: string;
}

// A single turn in a conversation, in the shape every major LLM API expects.
// Text is always present; images ride alongside when the turn has any, and
// each provider translates them into its own wire format.
export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: ImageAttachment[];
  files?: ImageAttachment[];
}

// Knobs the caller can pass for a single completion request.
export interface CompletionOptions {
  // Which specific model to use (e.g. "llama-3.3-70b-versatile", "gpt-4o").
  // If omitted, the provider falls back to its own default model.
  model?: string;
  // Hard time budget for the whole request, in milliseconds.
  timeoutMs?: number;
  // Sampling temperature (0 = focused, higher = more random). Passed through to
  // the backend when provided. Mainly used by the OpenAI-compatible proxy.
  temperature?: number;
  // Upper bound on reply length (tokens). Passed through when provided.
  maxTokens?: number;
  // A caller-supplied API key for this single request ("bring your own key").
  // When present it is used INSTEAD of the server's own env key, and is never
  // stored or logged. When absent the provider falls back to its env key.
  apiKey?: string;
}

// The contract itself. A "provider" is one company's/back-end's implementation.
export interface ChatProvider {
  // Stable short name used to select this provider (e.g. "groq", "openai").
  readonly id: string;
  // The model this provider uses when the caller does not name one.
  readonly defaultModel: string;
  // A short curated list of well-known model names a picker UI can offer.
  // This is a convenience for the interface; callers may still request any
  // model name the backend accepts.
  readonly suggestedModels: string[];
  // Which of this backend's models accept images. Used by the picker and by
  // automatic routing to send image messages only to models that can see.
  readonly visionModels: string[];
  // Which of this backend's models accept document (PDF) attachments.
  readonly documentModels: string[];
  // Whether the necessary configuration (usually an API key) is present.
  // Lets the app fail early with a clear message instead of mid-request.
  isConfigured(): boolean;
  // Take the pruned conversation and return the model's reply as plain text.
  complete(messages: LlmMessage[], options?: CompletionOptions): Promise<string>;
}

// A plain summary of one provider, safe to send to a frontend so it can build a
// model picker. Never includes secrets (only whether a key is present).
export interface ProviderInfo {
  id: string;
  defaultModel: string;
  suggestedModels: string[];
  visionModels: string[];
  documentModels: string[];
  configured: boolean;
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

// A caller tried to send their API key over an insecure (non-HTTPS) connection
// in production. We refuse rather than let a key travel in the clear.
export class InsecureKeyTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsecureKeyTransportError';
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
