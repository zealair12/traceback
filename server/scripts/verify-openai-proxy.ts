// Integration check of the OpenAI-compatible proxy WITHOUT a real API key.
//
// Plain-English: this starts the real Traceback server plus a tiny fake
// "OpenAI-style" model, then behaves like an app that normally talks to OpenAI:
//   1. Drop-in: sends a standard chat request and confirms it gets back an
//      OpenAI-shaped reply and that a conversation tree was created.
//   2. Branch-aware: sends a request tied to a specific Traceback session and
//      confirms the new turn was stored under that session.
//   3. Confirms streaming requests and unknown providers are rejected clearly.
// It proves the proxy works through the real HTTP layer and database.

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
            choices: [{ message: { role: 'assistant', content: 'proxy reply from fake model' } }]
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
  const PORT = 4555;
  const base = `http://127.0.0.1:${PORT}`;

  const child = spawn('npx', ['tsx', serverEntry], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      LLM_PROVIDER: 'local',
      LOCAL_BASE_URL: `http://127.0.0.1:${mock.port}/v1`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  const cleanup = () => {
    child.kill('SIGTERM');
    mock.close();
  };

  const post = (bodyObj: unknown) =>
    fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

  try {
    await waitForHealth(base);

    // 1. Drop-in: a plain OpenAI-style request.
    const dropResp = await post({
      model: 'local/llama3.1',
      messages: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'hello proxy' }
      ]
    });
    const drop = await dropResp.json();
    console.log('drop-in status:', dropResp.status);
    console.log('drop-in object:', drop.object, '| model:', drop.model);
    console.log('drop-in reply:', JSON.stringify(drop.choices?.[0]?.message?.content));
    console.log('drop-in created session:', drop.traceback?.session_id ? 'yes' : 'no');

    // 2. Branch-aware: tie a request to an existing session.
    const session = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'proxy-branch-test' })
    }).then((r) => r.json());

    const branchResp = await post({
      model: 'local/llama3.1',
      messages: [{ role: 'user', content: 'tied to a session' }],
      session_id: session.id
    });
    const branch = await branchResp.json();
    const sessionMsgs = await fetch(`${base}/sessions/${session.id}/messages`).then((r) => r.json());
    console.log('branch-aware status:', branchResp.status);
    console.log('branch-aware stored under session (message count):', sessionMsgs.length);

    // 3. Streaming rejected.
    const streamResp = await post({
      model: 'local/llama3.1',
      messages: [{ role: 'user', content: 'x' }],
      stream: true
    });
    console.log('stream status (expect 400):', streamResp.status);

    // 4. Unknown provider rejected.
    const badResp = await post({
      model: 'nope/whatever',
      messages: [{ role: 'user', content: 'x' }]
    });
    console.log('bad provider status (expect 400):', badResp.status);

    // Tidy up created sessions/messages where practical.
    if (drop.traceback?.user_message_id) {
      await fetch(`${base}/messages/${drop.traceback.user_message_id}`, { method: 'DELETE' });
    }
    if (branch.traceback?.user_message_id) {
      await fetch(`${base}/messages/${branch.traceback.user_message_id}`, { method: 'DELETE' });
    }

    const ok =
      dropResp.status === 200 &&
      drop.object === 'chat.completion' &&
      drop.choices?.[0]?.message?.content === 'proxy reply from fake model' &&
      Boolean(drop.traceback?.session_id) &&
      branchResp.status === 200 &&
      sessionMsgs.length === 2 &&
      streamResp.status === 400 &&
      badResp.status === 400;

    cleanup();
    if (!ok) {
      console.error('FAILED: OpenAI-compatible proxy did not behave as expected.');
      process.exit(1);
    }
    console.log('PASSED: drop-in, branch-aware, streaming-rejection, and bad-provider all work.');
  } catch (e) {
    cleanup();
    console.error(e);
    process.exit(1);
  }
}

main();
