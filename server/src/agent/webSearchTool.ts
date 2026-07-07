// A web-search tool for the agent, built entirely on OpenRouter.
//
// Plain-English: OpenRouter can search the web when you talk to an ":online"
// model. So this "tool" is just a small helper: given a query, ask an online
// model to look it up and return findings with source links. No separate search
// API key is needed — it reuses the OpenRouter key the rest of the app uses.

import OpenAI from 'openai';
import type { AgentTool } from './agentLoop.js';

export function createWebSearchTool(opts: {
  apiKey: string;
  baseURL?: string;
  model: string;
}): AgentTool {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  // Ensure the search sub-request uses an online (web-enabled) model.
  const onlineModel = opts.model.includes(':online') ? opts.model : `${opts.model}:online`;

  return {
    name: 'web_search',
    description:
      'Search the web for current or factual information. Returns key findings with source URLs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for' }
      },
      required: ['query']
    },
    run: async (args) => {
      const query = String((args as { query?: unknown }).query ?? '').trim();
      if (!query) return 'No query provided.';
      const res = await client.chat.completions.create({
        model: onlineModel,
        messages: [
          {
            role: 'system',
            content:
              'Search the web and answer concisely. Always include the source URLs you used as markdown links.'
          },
          { role: 'user', content: query }
        ]
      });
      return res.choices[0]?.message?.content ?? 'No results.';
    }
  };
}
