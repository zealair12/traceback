// Speech-to-text with Cohere Transcribe (open-weights, Apache 2.0; currently the
// top model on Hugging Face's Open ASR leaderboard), via Cohere's hosted API.
//
// Plain-English notes:
// - It needs the spoken language up front (no auto-detect), as an ISO-639-1
//   code from the 14 it supports; we default to English.
// - It accepts flac/mp3/mpeg/mpga/ogg/wav, NOT webm or mp4 (what browsers
//   record). The web client converts recordings to 16 kHz mono WAV first.
// - Trial keys are limited (5 transcriptions/min, 1,000 API calls/month), so the
//   route falls back to Groq Whisper when Cohere refuses.

export const COHERE_TRANSCRIBE_MODEL = process.env.COHERE_TRANSCRIBE_MODEL ?? 'cohere-transcribe-03-2026';

const SUPPORTED_LANGUAGES = new Set(['en', 'fr', 'de', 'it', 'es', 'pt', 'el', 'nl', 'pl', 'zh', 'ja', 'ko', 'vi', 'ar']);

// "en-US" / "EN" / undefined -> a supported ISO-639-1 code (English by default).
export function cohereLanguage(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.trim().toLowerCase().split(/[-_]/)[0] : '';
  return SUPPORTED_LANGUAGES.has(code) ? code : 'en';
}

export const cohereAcceptsAudio = (mediaType: string) => /(flac|mp3|mpeg|mpga|ogg|wav)/.test(mediaType);

export async function transcribeWithCohere(opts: {
  bytes: Buffer;
  mediaType: string;
  language: string;
  apiKey: string;
  baseURL?: string;
}): Promise<string> {
  const ext = opts.mediaType.match(/(flac|mp3|mpeg|mpga|ogg|wav)/)?.[1] ?? 'wav';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(opts.bytes)], { type: opts.mediaType }), `recording.${ext}`);
  form.append('model', COHERE_TRANSCRIBE_MODEL);
  form.append('language', opts.language);

  const base = (opts.baseURL ?? 'https://api.cohere.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v2/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Cohere transcription failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const json = (await res.json()) as { text?: string };
  return json.text ?? '';
}
