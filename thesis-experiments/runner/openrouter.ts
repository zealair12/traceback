// Minimal OpenRouter chat-completions client with retries.
// The API key comes from process.env.OPENROUTER_API_KEY (loaded from
// .env.experiment by the guard) and is never logged.

export interface ModelSpec {
  role: string;
  id: string;
  provider: string;
  temperature: number | null;
  seed: number | null;
  price: { in: number; out: number };
}

export interface CallParams {
  model: ModelSpec;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  reasoningEffort: string | null;
  allowFallbacks: boolean;
}

export interface CallResult {
  ok: boolean;
  status: number | null;
  text: string | null;
  finish_reason: string | null;
  provider: string | null;           // provider OpenRouter reports it used
  model_reported: string | null;
  generation_id: string | null;
  usage: {
    prompt_tokens: number | null;
    completion_tokens: number | null;
    reasoning_tokens: number | null;
    cost_usd: number | null;         // OpenRouter-reported cost when available
  };
  error: string | null;
  attempts: number;
  request_body: Record<string, unknown>;
}

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function requestBody(p: CallParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: p.model.id,
    messages: p.messages,
    max_tokens: p.maxTokens,
    provider: { order: [p.model.provider], allow_fallbacks: p.allowFallbacks },
    usage: { include: true },
    stream: false
  };
  if (p.model.temperature !== null) body.temperature = p.model.temperature;
  if (p.model.seed !== null) body.seed = p.model.seed;
  if (p.reasoningEffort) body.reasoning = { effort: p.reasoningEffort };
  return body;
}

export async function callOpenRouter(p: CallParams, maxAttempts = 6): Promise<CallResult> {
  const key = process.env.OPENROUTER_API_KEY;
  const body = requestBody(p);
  const base: CallResult = {
    ok: false, status: null, text: null, finish_reason: null, provider: null, model_reported: null, generation_id: null,
    usage: { prompt_tokens: null, completion_tokens: null, reasoning_tokens: null, cost_usd: null },
    error: null, attempts: 0, request_body: body
  };
  if (!key) return { ...base, error: 'OPENROUTER_API_KEY missing from .env.experiment' };

  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    base.attempts = attempt;
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'thesis-experiment'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000)
      });
      const raw = await res.text();
      let json: any = null;
      try { json = JSON.parse(raw); } catch { /* non-JSON error page */ }
      // OpenRouter can return 200 with an error object, or a provider error inside choices.
      const apiErr = json?.error ?? json?.choices?.[0]?.error;
      if (!res.ok || apiErr) {
        const code = Number(apiErr?.code) || res.status;
        lastErr = `${code}: ${String(apiErr?.message ?? raw).slice(0, 400)}`;
        if (RETRYABLE.has(code) && attempt < maxAttempts) {
          await sleep(Math.min(60_000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500);
          continue;
        }
        return { ...base, status: code, error: lastErr };
      }
      const choice = json.choices?.[0];
      const u = json.usage ?? {};
      return {
        ...base,
        ok: true,
        status: res.status,
        text: choice?.message?.content ?? '',
        finish_reason: choice?.finish_reason ?? choice?.native_finish_reason ?? null,
        provider: json.provider ?? null,
        model_reported: json.model ?? null,
        generation_id: json.id ?? null,
        usage: {
          prompt_tokens: u.prompt_tokens ?? null,
          completion_tokens: u.completion_tokens ?? null,
          reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? null,
          cost_usd: typeof u.cost === 'number' ? u.cost : null
        }
      };
    } catch (e) {
      lastErr = `network: ${(e as Error).message}`;
      if (attempt < maxAttempts) {
        await sleep(Math.min(60_000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500);
        continue;
      }
    }
  }
  return { ...base, error: lastErr };
}
