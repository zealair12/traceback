// Verifies the streaming pipeline end to end WITHOUT a real provider:
//   mock OpenAI-streaming model  ->  traceback server (/message/stream)  ->  SSE
// It confirms tokens arrive incrementally, the final "done" event carries the
// stored messages, and the assistant reply persisted equals the streamed text.
//
// Run: DATABASE_URL=postgresql://HP@localhost:5432/traceback_db npx tsx scripts/verify-stream.ts

import http from 'node:http';
import { spawn } from 'node:child_process';

const MOCK_PORT = 4711;
const SRV_PORT = 4712;
const base = `http://127.0.0.1:${SRV_PORT}`;
const TOKENS = ['Hello', ', ', 'this ', 'streamed ', 'in ', 'parts', '.'];

// 1. Mock model: OpenAI-compatible streaming chat completions.
const mock = http.createServer((req, res) => {
  if (!req.url?.includes('/chat/completions')) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  let i = 0;
  const iv = setInterval(() => {
    if (i < TOKENS.length) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: TOKENS[i] } }] })}\n\n`);
      i++;
    } else {
      res.write('data: [DONE]\n\n');
      clearInterval(iv);
      res.end();
    }
  }, 8);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await new Promise<void>((r) => mock.listen(MOCK_PORT, r));

  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(SRV_PORT),
      LLM_PROVIDER: 'local',
      LOCAL_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://HP@localhost:5432/traceback_db',
      GOOGLE_CLIENT_ID: 'd', GOOGLE_CLIENT_SECRET: 'd', GOOGLE_CALLBACK_URL: 'http://x/cb', SESSION_SECRET: 't'
    },
    stdio: ['ignore', 'ignore', 'inherit']
  });

  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await sleep(200); }

    // Session (captures a guest cookie so ownership + read-back work).
    const r1 = await fetch(`${base}/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const cookie = r1.headers.get('set-cookie')?.split(';')[0] ?? '';
    const session = await r1.json();

    // Stream a message and parse the SSE.
    const streamRes = await fetch(`${base}/message/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ session_id: session.id, content: 'stream please' })
    });
    const reader = streamRes.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const tokenChunks: string[] = [];
    let done: any = null;
    let errored: any = null;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop() ?? '';
      for (const block of blocks) {
        const ev = /event: (.*)/.exec(block)?.[1];
        const data = /data: (.*)/.exec(block)?.[1];
        if (!ev || !data) continue;
        const parsed = JSON.parse(data);
        if (ev === 'token') tokenChunks.push(parsed.chunk);
        if (ev === 'done') done = parsed;
        if (ev === 'error') errored = parsed;
      }
    }

    const streamed = tokenChunks.join('');
    const stored = await fetch(`${base}/sessions/${session.id}/messages`, { headers: { cookie } }).then((r) => r.json());
    const asst = Array.isArray(stored) ? stored.find((m: any) => m.role === 'assistant') : null;

    console.log('error event:', errored ? JSON.stringify(errored) : 'none');
    console.log('token events received:', tokenChunks.length, '(mock sent', TOKENS.length + ')');
    console.log('streamed text:', JSON.stringify(streamed));
    console.log('done event has messages:', !!(done?.userMessage && done?.assistantMessage));
    console.log('stored assistant content:', JSON.stringify(asst?.content));

    const pass =
      !errored &&
      tokenChunks.length === TOKENS.length &&
      streamed === TOKENS.join('') &&
      !!done?.assistantMessage &&
      asst?.content === TOKENS.join('');
    console.log(pass ? '\nPASS: streaming works end to end (tokens streamed + reply persisted).' : '\nFAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    child.kill('SIGTERM');
    mock.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
