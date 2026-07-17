// Speech-to-text endpoint: turn recorded audio (or an audio file) into text.
//
// Plain-English big picture:
// The browser records the user's voice (or the user drops an audio file) and
// sends the audio here as a base64 data URL. We hand it to a Whisper
// transcription model -- on Groq if a Groq key is available (env or the
// caller's own key), otherwise on OpenAI -- and return the recognized text.
// The text goes back into the input box for the user to edit before sending,
// so speech becomes just another way to type. The audio itself is used for
// this one request and never stored.

import type { Express, Request, Response, NextFunction } from 'express';
import OpenAI from 'openai';
import { resolveApiKey } from '../auth/apiKey.js';

// Roughly 25MB of audio once base64-decoded.
const MAX_AUDIO_CHARS = 35_000_000;

export function registerTranscribeRoutes(app: Express) {
  app.post('/transcribe', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { audio, mediaType } = req.body ?? {};
      if (
        typeof audio !== 'string' ||
        !audio.startsWith('data:audio/') ||
        audio.length > MAX_AUDIO_CHARS ||
        typeof mediaType !== 'string' ||
        !mediaType.startsWith('audio/')
      ) {
        res.status(400).json({
          error: 'audio must be a data:audio/... base64 URL under 25MB, with an audio/* mediaType.'
        });
        return;
      }

      // The caller's own key (bring-your-own-key) wins over server env keys,
      // exactly like chat requests.
      const userKey = resolveApiKey(req);

      // Whisper transcription is paid. Don't let an anonymous caller spend the
      // server key on it. The live mic uses the browser's free Web Speech API,
      // so guests can still dictate; server-side transcription of audio files
      // (and the fallback path) needs a signed-in session or the caller's key.
      if (!userKey && !req.isAuthenticated()) {
        res.status(401).json({
          error:
            'Sign in or provide your own API key to transcribe audio. (Live dictation via the mic is free and needs neither.)'
        });
        return;
      }

      const groqKey = userKey ?? process.env.GROQ_API_KEY;
      const openaiKey = userKey ?? process.env.OPENAI_API_KEY;

      // Decode the data URL into a File the transcription SDKs accept.
      const base64 = audio.slice(audio.indexOf(',') + 1);
      const bytes = Buffer.from(base64, 'base64');
      const ext = mediaType.includes('webm') ? 'webm' : mediaType.includes('mp4') ? 'mp4' : 'audio';
      const file = new File([bytes], `recording.${ext}`, { type: mediaType });

      let text: string;
      let provider: string;
      let model: string;
      if (groqKey) {
        provider = 'groq';
        model = 'whisper-large-v3';
        // Groq's API is OpenAI-compatible, so the same SDK reaches its
        // Whisper endpoint. GROQ_BASE_URL exists for tests and gateways.
        const groq = new OpenAI({
          apiKey: groqKey,
          baseURL: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
          timeout: 60_000
        });
        const result = await groq.audio.transcriptions.create({ file, model });
        text = result.text ?? '';
      } else if (openaiKey) {
        provider = 'openai';
        model = 'whisper-1';
        const openai = new OpenAI({
          apiKey: openaiKey,
          baseURL: process.env.OPENAI_BASE_URL,
          timeout: 60_000
        });
        const result = await openai.audio.transcriptions.create({ file, model });
        text = result.text ?? '';
      } else {
        res.status(400).json({
          error:
            'No transcription backend available: add a Groq or OpenAI key (server .env or your own key) to use speech input.'
        });
        return;
      }

      res.json({ text, provider, model });
    } catch (error: unknown) {
      next(error);
    }
  });
}
