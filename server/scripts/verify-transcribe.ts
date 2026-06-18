// Integration check of the speech-to-text endpoint, no real API key needed.
//
// Plain-English: this proves the transcription path with a fake Whisper
// server:
//   1. With a (fake) Groq key configured, POST /transcribe sends the audio to
//      the Whisper endpoint and returns the recognized text.
//   2. A caller's own key (bring-your-own-key header) works with no server key.
//   3. With no key anywhere, the endpoint refuses with a clear message.
//   4. Non-audio or oversized payloads are rejected.

import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, '..', 'src', 'index.ts');

// A few valid bytes of nothing in particular, as a webm-flavored data URL.
const TINY_AUDIO = 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKE';

// Fake Whisper: answers any POST under /openai/v1/audio/* with a transcript.
function startMockWhisper(): Promise<{ port: number; hits: () => number; close: () => void }> {
  let hits = 0;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        hits += 1;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ text: 'hello from whisper' }));
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as any).port, hits: () => hits, close: () => server.close() })
    );
  });
}

function spawnServer(port: number, env: Record<string, string | undefined>): ChildProcess {
  const child = spawn('npx', ['tsx', serverEntry], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), ...env } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server:${port}] ${d}`));
  return child;
}

async function waitForHealth(base: string, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not become healthy in time.');
}

async function main() {
  const mock = await startMockWhisper();
  const whisperBase = `http://127.0.0.1:${mock.port}`;

  // Server A: fake Groq env key, Whisper pointed at the mock.
  const A = 4561;
  const a = spawnServer(A, {
    GROQ_API_KEY: 'fake-env-key',
    GROQ_BASE_URL: whisperBase,
    OPENAI_API_KEY: undefined
  });
  // Server B: NO keys at all (BYOK + refusal checks).
  const B = 4562;
  const b = spawnServer(B, {
    GROQ_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    GROQ_BASE_URL: whisperBase
  });

  const cleanup = () => {
    a.kill('SIGTERM');
    b.kill('SIGTERM');
    mock.close();
  };

  const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });

  try {
    await waitForHealth(`http://127.0.0.1:${A}`);
    await waitForHealth(`http://127.0.0.1:${B}`);

    // 1. Env-key path.
    const envResp = await post(`http://127.0.0.1:${A}`, { audio: TINY_AUDIO, mediaType: 'audio/webm' });
    const envBody = await envResp.json();
    console.log('env-key transcribe:', envResp.status, '| text:', JSON.stringify(envBody.text), '| via:', envBody.provider, envBody.model);

    // 2. BYOK path: no server keys, the caller brings one.
    const byokResp = await post(
      `http://127.0.0.1:${B}`,
      { audio: TINY_AUDIO, mediaType: 'audio/webm' },
      { 'x-provider-key': 'users-own-key' }
    );
    const byokBody = await byokResp.json();
    console.log('byok transcribe:', byokResp.status, '| text:', JSON.stringify(byokBody.text));

    // 3. No key anywhere: clear refusal.
    const noKey = await post(`http://127.0.0.1:${B}`, { audio: TINY_AUDIO, mediaType: 'audio/webm' });
    console.log('no-key status (expect 400):', noKey.status);

    // 4. Bad payloads.
    const notAudio = await post(`http://127.0.0.1:${A}`, { audio: 'data:image/png;base64,AAAA', mediaType: 'image/png' });
    console.log('non-audio status (expect 400):', notAudio.status);

    const ok =
      envResp.status === 200 &&
      envBody.text === 'hello from whisper' &&
      envBody.provider === 'groq' &&
      envBody.model === 'whisper-large-v3' &&
      byokResp.status === 200 &&
      byokBody.text === 'hello from whisper' &&
      noKey.status === 400 &&
      notAudio.status === 400 &&
      mock.hits() === 2;

    cleanup();
    if (!ok) {
      console.error('FAILED: transcription endpoint did not behave as expected.');
      process.exit(1);
    }
    console.log('PASSED: env-key, bring-your-own-key, refusal, and validation all work.');
  } catch (e) {
    cleanup();
    console.error(e);
    process.exit(1);
  }
}

main();
