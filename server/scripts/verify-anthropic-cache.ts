// Check that the Anthropic provider asks for prompt caching WITHOUT a real key.
//
// Plain-English: Anthropic discounts repeated system prompts only when the
// request marks them with a cache_control flag. We start a tiny fake
// "Anthropic-style" server on this machine, point the provider at it, and
// inspect the request it receives: the system prompt must arrive as a block
// carrying cache_control {type: "ephemeral"}. That is the entire opt-in, so
// seeing it on the wire proves caching is requested on every real call too.

import http from 'node:http';

async function main() {
  let receivedBody: any = null;

  // Minimal stand-in for Anthropic's /v1/messages endpoint.
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw || '{}');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          content: [{ type: 'text', text: 'pong from fake claude' }],
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;

  // Point the Anthropic SDK at our fake server BEFORE importing the provider.
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';

  const { getProvider } = await import('../src/providers/index.js');
  const provider = getProvider('anthropic');

  const reply = await provider.complete([
    { role: 'system', content: 'be human, avoid AI writing tropes' },
    { role: 'user', content: 'ping' },
  ]);

  server.close();

  const systemBlocks = receivedBody?.system;
  const cacheFlag = Array.isArray(systemBlocks) ? systemBlocks[0]?.cache_control : undefined;

  console.log('reply received by provider:', JSON.stringify(reply));
  console.log('system field shape:', Array.isArray(systemBlocks) ? 'array of blocks' : typeof systemBlocks);
  console.log('cache_control sent:', JSON.stringify(cacheFlag));

  const ok =
    reply === 'pong from fake claude' &&
    Array.isArray(systemBlocks) &&
    systemBlocks[0]?.text === 'be human, avoid AI writing tropes' &&
    cacheFlag?.type === 'ephemeral';

  if (!ok) {
    console.error('FAILED: the request did not carry the prompt-caching flag.');
    process.exit(1);
  }
  console.log('PASSED: the system prompt is sent as a cacheable block on every Anthropic call.');
}

main();
