// Integration check for "bring your own key" (BYOK).
//
// Plain-English: this proves that when a caller sends their own API key in a
// request header, that exact key is what reaches the model provider (instead of
// the server's env key), for both the normal send endpoint and the OpenAI proxy.
// It also proves the production guard refuses a key sent over plain HTTP.
// The fake model server records the Authorization header it receives, so we can
// confirm the user's key flowed all the way through.

import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, '..', 'src', 'index.ts');

// Fake OpenAI-style model server that remembers the auth header it last saw.
function startMockModelServer(): Promise<{ port: number; lastAuth: () => string | undefined; close: () => void }> {
  let lastAuth: string | undefined;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      lastAuth = req.headers['authorization'] as string | undefined;
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as any).port, lastAuth: () => lastAuth, close: () => server.close() })
    );
  });
}

function spawnServer(port: number, mockPort: number, extraEnv: Record<string, string>): ChildProcess {
  const child = spawn('npx', ['tsx', serverEntry], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      LLM_PROVIDER: 'local',
      LOCAL_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
      ...extraEnv
    },
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
  const mock = await startMockModelServer();
  const PORT = 4556;
  const PROD_PORT = 4557;
  const base = `http://127.0.0.1:${PORT}`;
  const prodBase = `http://127.0.0.1:${PROD_PORT}`;

  const dev = spawnServer(PORT, mock.port, {});
  const prod = spawnServer(PROD_PORT, mock.port, { NODE_ENV: 'production' });

  const cleanup = () => {
    dev.kill('SIGTERM');
    prod.kill('SIGTERM');
    mock.close();
  };

  try {
    await waitForHealth(base);
    await waitForHealth(prodBase);

    // 1. /message/send with a user key in x-provider-key header.
    const session = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'byok-test' })
    }).then((r) => r.json());

    const sendResp = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-provider-key': 'USER-KEY-AAA' },
      body: JSON.stringify({ session_id: session.id, content: 'hi', provider: 'local' })
    });
    const sendAuth = mock.lastAuth();
    console.log('send status:', sendResp.status, '| model saw auth:', sendAuth);

    // 2. /v1/chat/completions with the key as Authorization: Bearer (OpenAI style).
    const proxyResp = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer USER-KEY-BBB' },
      body: JSON.stringify({ model: 'local/llama3.1', messages: [{ role: 'user', content: 'hi' }] })
    });
    const proxyAuth = mock.lastAuth();
    console.log('proxy status:', proxyResp.status, '| model saw auth:', proxyAuth);

    // 3. Production server must refuse a key sent over plain HTTP.
    const insecureResp = await fetch(`${prodBase}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-provider-key': 'USER-KEY-CCC' },
      body: JSON.stringify({ model: 'local/llama3.1', messages: [{ role: 'user', content: 'hi' }] })
    });
    console.log('insecure (prod, http) status (expect 400):', insecureResp.status);

    // Tidy up.
    await fetch(`${base}/messages/${session.id}`, { method: 'DELETE' }).catch(() => {});

    const ok =
      sendResp.status === 201 &&
      sendAuth === 'Bearer USER-KEY-AAA' &&
      proxyResp.status === 200 &&
      proxyAuth === 'Bearer USER-KEY-BBB' &&
      insecureResp.status === 400;

    cleanup();
    if (!ok) {
      console.error('FAILED: BYOK did not behave as expected.');
      process.exit(1);
    }
    console.log('PASSED: user keys reach the provider; production refuses keys over plain HTTP.');
  } catch (e) {
    cleanup();
    console.error(e);
    process.exit(1);
  }
}

main();
