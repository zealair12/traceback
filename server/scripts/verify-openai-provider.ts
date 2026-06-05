// End-to-end check of the OpenAI-compatible provider WITHOUT any real API key.
//
// Plain-English: we start a tiny fake "OpenAI-style" server on this machine that
// always replies with a fixed sentence, point the "local" provider at it, and
// confirm the provider sends a correctly-shaped request and reads the reply back
// out. This proves the whole request/response round-trip works, which is the
// part that real keys would otherwise be needed to exercise.

import http from 'node:http';

async function main() {
  let receivedBody: any = null;

  // Minimal stand-in for an OpenAI-compatible chat endpoint.
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw || '{}');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'pong from fake server' } }],
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  // Point the "local" provider at our fake server BEFORE importing it.
  process.env.LOCAL_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LOCAL_MODEL = 'test-model';

  const { getProvider } = await import('../src/providers/index.js');
  const provider = getProvider('local');

  const reply = await provider.complete([
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'ping' },
  ]);

  server.close();

  console.log('reply received by provider:', JSON.stringify(reply));
  console.log('model the provider sent:', receivedBody?.model);
  console.log('messages the provider sent:', JSON.stringify(receivedBody?.messages));

  const ok =
    reply === 'pong from fake server' &&
    receivedBody?.model === 'test-model' &&
    Array.isArray(receivedBody?.messages) &&
    receivedBody.messages.length === 2;

  if (!ok) {
    console.error('FAILED: OpenAI-compatible round-trip did not behave as expected.');
    process.exit(1);
  }
  console.log('PASSED: OpenAI-compatible provider sends and parses requests correctly.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
