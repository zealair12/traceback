// Proves the agent engine end to end against OpenRouter.
//
// Run it with your OpenRouter config in the environment:
//   OPENAI_API_KEY=sk-or-... \
//   OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
//   OPENAI_MODEL=google/gemini-2.5-flash-lite \
//   npx tsx scripts/verify-agent.ts "your question here"
//
// It prints each step (tool calls, tool results, final answer) so you can watch
// the ReAct loop think, search, and answer.

import 'dotenv/config';
import { runAgent } from '../src/agent/agentLoop.js';
import { createWebSearchTool } from '../src/agent/webSearchTool.js';

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL ?? 'google/gemini-2.5-flash-lite';
  if (!apiKey) {
    console.error('Set OPENAI_API_KEY (your OpenRouter key) to run this.');
    process.exit(1);
  }

  const task =
    process.argv[2] ??
    'What is the latest LTS version of Node.js, and roughly when was it released?';
  console.log('TASK:', task, '\n');

  const tool = createWebSearchTool({ apiKey, baseURL, model });
  const { answer, steps } = await runAgent({
    task,
    tools: [tool],
    apiKey,
    baseURL,
    model,
    maxSteps: 6,
    onStep: (s) => {
      const detail =
        s.type === 'tool_result'
          ? s.content.slice(0, 200) + (s.content.length > 200 ? '…' : '')
          : s.args ?? s.content;
      console.log(`[${s.type}]${s.tool ? ' ' + s.tool : ''} ${detail}`);
    }
  });

  console.log(`\n=== FINAL ANSWER (${steps.length} steps) ===\n${answer}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
