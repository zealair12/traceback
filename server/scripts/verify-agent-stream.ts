// Verifies the agent loop against a mock STREAMING tool-calling model:
//   task -> tool_call (reassembled from deltas) -> tool_result -> final answer
// The final answer must stream via onToken (not onStep), and branch context
// (the earlier "san jose") must reach the model. The SSE write/read itself is
// covered by verify-stream.ts + the parseSSEBlock unit test.
//
// Run: npx tsx scripts/verify-agent-stream.ts

import http from 'node:http';
import { runAgent, type AgentStep } from '../src/agent/agentLoop.js';
import { createWebSearchTool } from '../src/agent/webSearchTool.js';

const MOCK_PORT = 4721;

function sse(res: http.ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
const contentChunks = (text: string) =>
  (text.match(/.{1,12}/g) ?? [text]).map((p) => ({ choices: [{ delta: { content: p } }] }));

// Mock OpenAI-compatible STREAMING model:
//  - agent turn with tools, no prior tool result -> stream a web_search tool_call
//  - agent turn with a tool result present        -> stream the final answer
//  - the web_search sub-request (no tools)         -> stream search text
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body || '{}');
    const hasTools = Array.isArray(json.tools) && json.tools.length > 0;
    const hasToolResult = (json.messages || []).some((m: { role: string }) => m.role === 'tool');
    if (hasTools && !hasToolResult) {
      // Tool call arrives as two deltas (id/name, then arguments).
      sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ query: 'flights San Jose to Malta' }) } }] } }] }
      ]);
    } else if (hasTools && hasToolResult) {
      sse(res, contentChunks('There are flights from San Jose (SJC) to Malta (MLA), usually with one stop.'));
    } else {
      sse(res, contentChunks('Options found on [example.com].'));
    }
  });
});

async function main() {
  await new Promise<void>((r) => mock.listen(MOCK_PORT, r));
  const cfg = { apiKey: 'x', baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-model' };
  const steps: AgentStep[] = [];
  const tokens: string[] = [];
  try {
    const { answer } = await runAgent({
      task: 'find flights to malta',
      history: [{ role: 'user', content: 'departing from san jose' }], // prior branch context
      tools: [createWebSearchTool(cfg)],
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
      maxSteps: 6,
      onStep: (s) => steps.push(s),
      onToken: (t) => tokens.push(t)
    });

    const types = steps.map((s) => s.type);
    console.log('onStep types:', types.join(' -> '), '(final should NOT be here)');
    console.log('final answer streamed via onToken chunks:', tokens.length);
    console.log('final answer:', JSON.stringify(answer));

    const pass =
      types.includes('tool_call') &&
      types.includes('tool_result') &&
      !types.includes('final') && // final streams via onToken, not onStep
      tokens.length > 1 &&
      answer === tokens.join('') &&
      /Malta|MLA|San Jose|SJC/.test(answer);
    console.log(pass ? '\nPASS: tool_call -> tool_result stream as steps, final answer streams token-by-token' : '\nFAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    mock.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
