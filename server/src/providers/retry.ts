// Shared "try again sensibly" helper used by every provider.
//
// Plain-English big picture:
// Network calls to LLM companies sometimes fail for boring, temporary reasons
// (a brief rate limit, a hiccup on their side). This helper wraps any single
// request so that: (1) we give up if it runs longer than a time budget, and
// (2) we automatically retry a few times with growing pauses for the kinds of
// failures that are worth retrying. Putting this in one place means Groq,
// OpenAI, Anthropic and friends all behave identically without copy-pasting.

import retry from 'async-retry';
import { ApiRateLimitError, LlmTimeoutError } from './types.js';

// How a provider classifies one of its own errors for the retry logic.
export type ErrorKind = 'rate-limit' | 'retryable' | 'fatal';

export interface CallWithRetryOptions {
  // Total time budget for a single attempt, in milliseconds.
  timeoutMs: number;
  // Provider-supplied function that looks at an error and says how to treat it.
  // Defaults to inspecting common HTTP status codes if not provided.
  classify?: (error: unknown) => ErrorKind;
  // Label used in logs so operators can tell which backend struggled.
  label: string;
}

// Default classification based on the HTTP status code most SDKs expose.
function classifyByStatus(error: unknown): ErrorKind {
  const status: number | undefined =
    (error as any)?.status ??
    (error as any)?.statusCode ??
    (error as any)?.response?.status;
  if (status === 429) return 'rate-limit';
  if (status && status < 500) return 'fatal'; // 4xx (bad request, auth) -> do not retry
  return 'retryable'; // network errors and 5xx -> retry
}

// Run `request` with a timeout and exponential-backoff retries.
// Returns the request's result, or throws the final error after exhausting tries.
export async function callWithRetry<T>(
  request: () => Promise<T>,
  options: CallWithRetryOptions
): Promise<T> {
  const { timeoutMs, label } = options;
  const classify = options.classify ?? classifyByStatus;

  // One attempt = the real request racing against a timeout timer.
  const attemptOnce = async (): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new LlmTimeoutError(`${label} call exceeded ${timeoutMs}ms timeout.`)),
        timeoutMs
      );
    });
    try {
      return await Promise.race([request(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    return await retry<T>(
      async (bail, attempt) => {
        try {
          return await attemptOnce();
        } catch (err: unknown) {
          // A timeout is worth one more shot, so let it fall through to retry.
          if (err instanceof LlmTimeoutError) throw err;

          const kind = classify(err);
          if (kind === 'rate-limit') {
            console.error(`[${label}] rate limit (HTTP 429) on attempt ${attempt}.`);
            throw new ApiRateLimitError(`${label} rate limit (HTTP 429).`);
          }
          if (kind === 'fatal') {
            bail(err as Error); // stop immediately; retrying will not help
            return undefined as never;
          }
          throw err; // retryable: let async-retry back off and try again
        }
      },
      { retries: 3, minTimeout: 500, maxTimeout: 4_000, factor: 2 }
    );
  } catch (err: unknown) {
    if (err instanceof LlmTimeoutError) console.error(`[${label} Timeout]`, err.message);
    else if (err instanceof ApiRateLimitError) console.error(`[${label} Rate Limit]`, err.message);
    else console.error(`[${label} Error]`, err);
    throw err;
  }
}
