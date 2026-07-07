// Agent route: run the ReAct loop for a task and record every step in the tree.
//
// Plain-English big picture:
// This is "Agent mode". Instead of a single question -> single answer, the model
// works a task step by step: it may search the web, read the result, and keep
// going until it can answer. We persist the task and each step as message nodes
// in the caller's session, so the whole trace is real, inspectable data (and the
// basis for later rendering the steps as branches in the graph).
//
// Safety rails (the "cutoff"): agent mode is limited to signed-in users (each run
// is many model calls), and the loop is capped at a small number of steps.

import type { Express } from 'express';
import { prisma } from '../prismaClient.js';
import { ownerWhere } from '../auth/owner.js';
import { wrap } from './wrap.js';
import { runAgent, type AgentStep, type AgentTool } from '../agent/agentLoop.js';
import { createWebSearchTool } from '../agent/webSearchTool.js';

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
  if (step.type === 'tool_call') return `🔍 **${step.tool}** ${step.args ?? ''}`.trim();
  if (step.type === 'tool_result') return step.content;
  return step.content; // final answer
}

export function registerAgentRoutes(app: Express) {
  app.post(
    '/agent/run',
    wrap(async (req, res) => {
      const { session_id: sessionId, parent_id: parentIdRaw, task } = req.body ?? {};

      if (!sessionId || typeof sessionId !== 'string') {
        res.status(400).json({ error: 'session_id is required and must be a string.' });
        return;
      }
      if (!task || typeof task !== 'string' || !task.trim()) {
        res.status(400).json({ error: 'task is required and must be a non-empty string.' });
        return;
      }
      // Agent mode is a signed-in feature (each run is many model calls).
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: 'Sign in to use agent mode.' });
        return;
      }
      // Only run inside a session the caller owns.
      const session = await prisma.session.findFirst({ where: { id: sessionId, ...ownerWhere(req) } });
      if (!session) {
        res.status(404).json({ error: 'This chat session no longer exists. Please start a new chat.' });
        return;
      }

      // Agent mode runs on the server's default OpenAI-compatible backend
      // (OpenRouter). It needs tool calling, which that key provides.
      const apiKey = process.env.OPENAI_API_KEY;
      const baseURL = process.env.OPENAI_BASE_URL;
      const model = process.env.OPENAI_MODEL;
      if (!apiKey || !model) {
        res.status(400).json({ error: 'Agent mode is not configured on this server.' });
        return;
      }

      // Derive the depth for the new task node from its parent (if any).
      let parentId: string | null = parentIdRaw ? String(parentIdRaw) : null;
      let depth = 0;
      if (parentId) {
        const parent = await prisma.message.findUnique({
          where: { id: parentId },
          select: { id: true, depth: true, sessionId: true }
        });
        if (!parent || parent.sessionId !== sessionId) {
          res.status(400).json({ error: 'Invalid parent_id for this session.' });
          return;
        }
        depth = parent.depth + 1;
      }

      // 1. Record the task as a user node.
      const taskNode = await prisma.message.create({
        data: { sessionId, parentId, role: 'user', content: task, depth }
      });

      // 2. Run the loop (capped). Tools are built on OpenRouter, no extra keys.
      const tools = [createWebSearchTool({ apiKey, baseURL, model }), datetimeTool];
      const { answer, steps } = await runAgent({
        task,
        tools,
        apiKey,
        baseURL,
        model,
        maxSteps: MAX_STEPS
      });

      // 3. Persist each step as a chained assistant node under the task, so the
      //    whole trace lives in the tree.
      let prevId = taskNode.id;
      let d = taskNode.depth + 1;
      const created = [];
      for (const step of steps) {
        const node = await prisma.message.create({
          data: {
            sessionId,
            parentId: prevId,
            role: 'assistant',
            content: renderStep(step),
            depth: d,
            provider: 'agent',
            model,
            branchLabel: step.type
          }
        });
        created.push(node);
        prevId = node.id;
        d += 1;
      }

      res.status(201).json({
        sessionId,
        taskMessage: taskNode,
        steps: created,
        answer
      });
    })
  );
}
