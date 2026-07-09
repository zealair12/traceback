// The agent engine: a plain ReAct loop.
//
// Plain-English big picture:
// An "agent" is not magic — it is a loop. We give the model a task and a list of
// tools it may call. Each turn the model either (a) asks to run a tool, or (b)
// gives a final answer. When it asks for a tool we run it, hand back the result,
// and loop again. We stop when the model answers or we hit a step cap (the
// safety rail that stops a runaway agent). Every step is recorded, which is what
// will later become nodes in the conversation tree.
//
// This module is self-contained: it talks to any OpenAI-compatible endpoint
// (OpenRouter, in our case) and does NOT touch the existing send/tree flow.

import OpenAI from 'openai';

export type AgentStepType = 'tool_call' | 'tool_result' | 'final';

// One recorded step of the agent's work. `tool`/`args` are set for tool steps.
export interface AgentStep {
  type: AgentStepType;
  content: string;
  tool?: string;
  args?: string;
}

// A tool the agent may call. `parameters` is a JSON Schema object describing the
// arguments; `run` receives the parsed args and returns a string result.
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface RunAgentOptions {
  task: string;
  tools: AgentTool[];
  apiKey: string;
  baseURL?: string;
  model: string;
  // Prior conversation turns (the branch's root-to-node context) so the agent
  // works the task in context, not in isolation.
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  // Hard cap on model turns, so the loop can never run forever.
  maxSteps?: number;
  // Called as each step happens, so a caller can stream progress (later: write
  // each step to the tree as a branch).
  onStep?: (step: AgentStep) => void;
}

const AGENT_SYSTEM =
  'You are an agent that solves the user\'s task step by step. ' +
  'Use the available tools to gather anything you do not already know (for example, search the web for current facts). ' +
  'Think about what you need, call a tool, read the result, then continue until you can answer. ' +
  'When you have enough, reply with the final answer in plain language, citing sources as markdown links when you used the web.';

export async function runAgent(
  opts: RunAgentOptions
): Promise<{ answer: string; steps: AgentStep[] }> {
  const { task, tools, apiKey, baseURL, model, maxSteps = 8, onStep, history = [] } = opts;
  const client = new OpenAI({ apiKey, baseURL });
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  // Describe the tools in the shape the model expects.
  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: AGENT_SYSTEM },
    // Prior branch context comes first, then the task as the latest turn.
    ...history.map((h) => ({ role: h.role, content: h.content } as OpenAI.Chat.ChatCompletionMessageParam)),
    { role: 'user', content: task }
  ];
  const steps: AgentStep[] = [];
  const record = (s: AgentStep) => {
    steps.push(s);
    onStep?.(s);
  };

  for (let i = 0; i < maxSteps; i++) {
    const res = await client.chat.completions.create({
      model,
      messages,
      tools: openaiTools,
      tool_choice: 'auto'
    });
    const msg = res.choices[0]?.message;
    if (!msg) break;

    // No tool requested → this is the final answer.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const answer = msg.content ?? '';
      record({ type: 'final', content: answer });
      return { answer, steps };
    }

    // Otherwise run each requested tool and feed the results back.
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      const name = call.function.name;
      const argsRaw = call.function.arguments || '{}';
      record({ type: 'tool_call', tool: name, args: argsRaw, content: `Calling ${name}` });

      const tool = toolByName.get(name);
      let result: string;
      if (!tool) {
        result = `Unknown tool: ${name}`;
      } else {
        try {
          result = await tool.run(JSON.parse(argsRaw));
        } catch (err) {
          result = `Tool error: ${err instanceof Error ? err.message : 'failed'}`;
        }
      }
      record({ type: 'tool_result', tool: name, content: result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  const fallback = 'Reached the step limit before finishing the task.';
  record({ type: 'final', content: fallback });
  return { answer: fallback, steps };
}
