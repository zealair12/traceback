// Full integration check of the send-message flow WITHOUT a real LLM key.
//
// Plain-English: this starts the real Traceback server, plus a tiny fake
// "OpenAI-style" model server, then behaves like a frontend would:
//   1. asks which providers/models are available (GET /providers)
//   2. starts a conversation and sends a message, explicitly choosing the
//      "local" provider so our fake model answers (POST /message/send)
//   3. confirms a nonsense provider name is rejected with a clear error
// It proves the per-message model-selection feature works through the actual
// HTTP layer and database, which is the real test of the Cursor-style picker.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, '..', 'src', 'index.ts');

function startMockModelServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'reply from fake local model' } }],
          })
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as any).port, close: () => server.close() });
    });
  });
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
  const PORT = 4123;
  const base = `http://127.0.0.1:${PORT}`;

  // Boot the real server as a child process, pointing the "local" provider at
  // our fake model server.
  const child = spawn('npx', ['tsx', serverEntry], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      LOCAL_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  const cleanup = () => {
    child.kill('SIGTERM');
    mock.close();
  };

  try {
    await waitForHealth(base);

    // 1. List providers.
    const provResp = await fetch(`${base}/providers`).then((r) => r.json());
    const ids = (provResp.providers ?? []).map((p: any) => p.id);
    console.log('GET /providers default:', provResp.default, '| ids:', ids);

    // 2. Create a session and send a message answered by the "local" provider.
    const session = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'flow-test' }),
    }).then((r) => r.json());

    const send = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'hello there',
        provider: 'local',
        model: 'test-model',
      }),
    });
    const sendBody = await send.json();
    console.log('POST /message/send status:', send.status);
    console.log('assistant reply stored:', JSON.stringify(sendBody.assistantMessage?.content));
    console.log(
      'provenance recorded (provider/model):',
      sendBody.assistantMessage?.provider,
      '/',
      sendBody.assistantMessage?.model
    );
    console.log('lineage length (root user + this user):', sendBody.lineage?.length);

    // 3. A bad provider name must be rejected with 400.
    const bad = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: session.id, content: 'x', provider: 'does-not-exist' }),
    });
    console.log('bad provider status (expect 400):', bad.status);

    // Tidy up the test conversation.
    await fetch(`${base}/messages/${sendBody.userMessage.id}`, { method: 'DELETE' });

    const ok =
      ids.includes('groq') &&
      ids.includes('openai') &&
      ids.includes('anthropic') &&
      ids.includes('local') &&
      send.status === 201 &&
      sendBody.assistantMessage?.content === 'reply from fake local model' &&
      sendBody.assistantMessage?.provider === 'local' &&
      sendBody.assistantMessage?.model === 'test-model' &&
      bad.status === 400;

    cleanup();
    if (!ok) {
      console.error('FAILED: message flow did not behave as expected.');
      process.exit(1);
    }
    console.log('PASSED: provider listing, model selection, and error handling all work.');
  } catch (e) {
    cleanup();
    console.error(e);
    process.exit(1);
  }
}

main();
