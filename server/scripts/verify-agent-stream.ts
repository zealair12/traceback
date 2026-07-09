// Verifies the agent loop's step emission (what /agent/stream forwards over SSE)
// against a mock tool-calling model: task -> tool_call -> tool_result -> final.
// The SSE write/read itself is covered by verify-stream.ts + the parseSSEBlock
// unit test; this proves the steps are produced in order with context.
//
// Run: npx tsx scripts/verify-agent-stream.ts

import http from 'node:http';
import { runAgent, type AgentStep } from '../src/agent/agentLoop.js';
import { createWebSearchTool } from '../src/agent/webSearchTool.js';

const MOCK_PORT = 4721;

// Mock OpenAI-compatible model. Non-streaming JSON completions:
//  - agent turn with tools, no prior tool result  -> ask for web_search
//  - agent turn with a tool result present         -> final answer
//  - the web_search sub-request (no tools)         -> search text
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body || '{}');
    const hasTools = Array.isArray(json.tools) && json.tools.length > 0;
    const hasToolResult = (json.messages || []).some((m: any) => m.role === 'tool');
    let message: any;
    if (hasTools && !hasToolResult) {
      message = {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'flights San Jose to Malta' }) } }
        ]
      };
    } else if (hasTools && hasToolResult) {
      message = { role: 'assistant', content: 'There are flights from San Jose (SJC) to Malta (MLA), typically with one stop.' };
    } else {
      message = { role: 'assistant', content: 'Options found on [example.com].' };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
});

async function main() {
  await new Promise<void>((r) => mock.listen(MOCK_PORT, r));
  const cfg = { apiKey: 'x', baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-model' };
  const steps: AgentStep[] = [];
  try {
    const { answer } = await runAgent({
      task: 'find flights to malta',
      // Prior branch context: the departure city mentioned earlier.
      history: [{ role: 'user', content: 'departing from san jose' }],
      tools: [createWebSearchTool(cfg)],
      apiKey: cfg.apiKey,
      baseURL: cfg.baseURL,
      model: cfg.model,
      maxSteps: 6,
      onStep: (s) => steps.push(s)
    });

    const types = steps.map((s) => s.type);
    console.log('step types in order:', types.join(' -> '));
    console.log('tool called:', steps.find((s) => s.type === 'tool_call')?.tool);
    console.log('final answer:', JSON.stringify(answer));

    const pass =
      types.includes('tool_call') &&
      types.includes('tool_result') &&
      types[types.length - 1] === 'final' &&
      /Malta|MLA|San Jose|SJC/.test(answer);
    console.log(pass ? '\nPASS: agent emits tool_call -> tool_result -> final in order' : '\nFAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    mock.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
