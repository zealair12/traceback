// Agent routes: run the ReAct loop for a task and record every step in the tree.
//
// Plain-English big picture:
// This is "Agent mode". Instead of a single question -> single answer, the model
// works a task step by step: it may search the web, read the result, and keep
// going until it can answer. We persist the task and each step as message nodes
// in the caller's session, so the whole trace is real, inspectable data (and the
// basis for later rendering the steps as branches in the graph).
//
// Two endpoints share the same setup: POST /agent/run answers all at once, while
// POST /agent/stream streams each step live over Server-Sent Events.
//
// Safety rails (the "cutoff"): agent mode is limited to signed-in users (each run
// is many model calls), and the loop is capped at a small number of steps.

import type { Express, Request, Response } from 'express';
import type { Message } from '@prisma/client';
import { prisma } from '../prismaClient.js';
import { ownerWhere } from '../auth/owner.js';
import { wrap } from './wrap.js';
import { runAgent, type AgentStep, type AgentTool } from '../agent/agentLoop.js';
import { createWebSearchTool } from '../agent/webSearchTool.js';
import { linkifyBareCitations, fetchLineageMessages } from '../services/messageService.js';

const MAX_STEPS = 6;

// A trivially-safe second tool (phase-4 breadth): agents often need "today" to
// frame a web search. No network, no eval — just the clock.
const datetimeTool: AgentTool = {
  name: 'current_datetime',
  description: 'Get the current UTC date and time. Useful before searching for recent events.',
  parameters: { type: 'object', properties: {} },
  run: async () => new Date().toISOString()
};

// How each recorded step is written into the tree as a node's content.
function renderStep(step: AgentStep): string {
  if (step.type === 'tool_call') return `**${step.tool}** ${step.args ?? ''}`.trim();
  // Fix bare bracketed citations into real links in results and the answer.
  return linkifyBareCitations(step.content);
}

interface AgentRunSetup {
  sessionId: string;
  task: string;
  taskNode: Message;
  history: Awaited<ReturnType<typeof fetchLineageMessages>>;
  tools: AgentTool[];
  apiKey: string;
  baseURL?: string;
  model: string;
}

// Validate the request, create the task node, and gather the branch context.
// Returns null (and has already sent the error response) when the request is bad.
async function prepareAgentRun(req: Request, res: Response): Promise<AgentRunSetup | null> {
  const { session_id: sessionId, parent_id: parentIdRaw, task } = req.body ?? {};

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'session_id is required and must be a string.' });
    return null;
  }
  if (!task || typeof task !== 'string' || !task.trim()) {
    res.status(400).json({ error: 'task is required and must be a non-empty string.' });
    return null;
  }
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Sign in to use agent mode.' });
    return null;
  }
  const session = await prisma.session.findFirst({ where: { id: sessionId, ...ownerWhere(req) } });
  if (!session) {
    res.status(404).json({ error: 'This chat session no longer exists. Please start a new chat.' });
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    res.status(400).json({ error: 'Agent mode is not configured on this server.' });
    return null;
  }

  const parentId: string | null = parentIdRaw ? String(parentIdRaw) : null;
  let depth = 0;
  if (parentId) {
    const parent = await prisma.message.findUnique({
      where: { id: parentId },
      select: { id: true, depth: true, sessionId: true }
    });
    if (!parent || parent.sessionId !== sessionId) {
      res.status(400).json({ error: 'Invalid parent_id for this session.' });
      return null;
    }
    depth = parent.depth + 1;
  }

  const taskNode = await prisma.message.create({
    data: { sessionId, parentId, role: 'user', content: task, depth }
  });
  // The branch's prior context, so the agent works in context, not isolation.
  const history = parentId ? await fetchLineageMessages(parentId) : [];
  const tools = [createWebSearchTool({ apiKey, baseURL, model }), datetimeTool];

  return { sessionId, task, taskNode, history, tools, apiKey, baseURL, model };
}

// Persist each step as a chained assistant node under the task node.
async function persistSteps(setup: AgentRunSetup, steps: AgentStep[]): Promise<Message[]> {
  let prevId = setup.taskNode.id;
  let depth = setup.taskNode.depth + 1;
  const created: Message[] = [];
  for (const step of steps) {
    const node = await prisma.message.create({
      data: {
        sessionId: setup.sessionId,
        parentId: prevId,
        role: 'assistant',
        content: renderStep(step),
        depth,
        provider: 'agent',
        model: setup.model,
        branchLabel: step.type
      }
    });
    created.push(node);
    prevId = node.id;
    depth += 1;
  }
  return created;
}

export function registerAgentRoutes(app: Express) {
  // Synchronous: run the whole loop, then return the trace.
  app.post(
    '/agent/run',
    wrap(async (req, res) => {
      const setup = await prepareAgentRun(req, res);
      if (!setup) return;
      const { answer, steps } = await runAgent({
        task: setup.task,
        tools: setup.tools,
        apiKey: setup.apiKey,
        baseURL: setup.baseURL,
        model: setup.model,
        maxSteps: MAX_STEPS,
        history: setup.history
      });
      const created = await persistSteps(setup, steps);
      res.status(201).json({ sessionId: setup.sessionId, taskMessage: setup.taskNode, steps: created, answer });
    })
  );

  // Streaming: emit each step live over SSE as the agent works, then a final
  // "done" event with the persisted nodes. The client falls back to /agent/run.
  app.post(
    '/agent/stream',
    wrap(async (req, res) => {
      const setup = await prepareAgentRun(req, res);
      if (!setup) return;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();
      const emit = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      try {
        const { answer, steps } = await runAgent({
          task: setup.task,
          tools: setup.tools,
          apiKey: setup.apiKey,
          baseURL: setup.baseURL,
          model: setup.model,
          maxSteps: MAX_STEPS,
          history: setup.history,
          onStep: (step) => emit('step', { type: step.type, tool: step.tool, content: renderStep(step) })
        });
        const created = await persistSteps(setup, steps);
        emit('done', { sessionId: setup.sessionId, taskMessage: setup.taskNode, steps: created, answer });
        res.end();
      } catch (err) {
        emit('error', { error: err instanceof Error ? err.message : 'Something went wrong' });
        res.end();
      }
    })
  );
}
