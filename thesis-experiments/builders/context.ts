// The three context builders. All read the same Traceback tables for a scenario's
// session, return an ordered list of {role, content} with the final question
// appended last, and report token counts and exposure.
//
//  ancestor  : production root-to-node path (recursive CTE over parent_id,
//              ordered by depth), copied from server/src/services/messageService.ts.
//              tests/builders.test.ts proves it returns the same rows as the
//              app's own queries for every sample tree.
//  full_tree : every message in the session created before the question, by createdAt.
//  window    : walk backward through the session by createdAt, keeping whole
//              messages until the next would exceed B = ancestor context tokens
//              (question excluded).
//
// Token unit: reference-tokenizer tokens of message content (question excluded
// from budgets). Real per-model usage is recorded separately by the runner.

import { countTokens } from './tokens.js';
import { containsTerm } from '../lib/match.js';
import { messageId, sessionId, createdAtOf } from '../loader/shared.js';
import type { Scenario } from '../lib/types.js';

// The app's own Prisma client type (no separate client is defined here).
type PrismaClient = (typeof import('../../server/src/prismaClient.js'))['prisma'];

export type Condition = 'ancestor' | 'full_tree' | 'window';
export const CONDITIONS: Condition[] = ['ancestor', 'full_tree', 'window'];

export interface Row { id: string; role: 'user' | 'assistant'; content: string; depth: number; created_at: Date }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface Exposure {
  sibling_messages: string[];          // scenario message ids from inactive branches
  sibling_branches: string[];          // branches with >= 1 message present
  canaries: string[];                  // planted canaries present in the context
  leak_values: string[];               // conflicting option values present
  active_messages: number;             // how many active-path messages survived
  active_total: number;
  required_fact_present: boolean;      // is the required-fact message in the context?
}

export interface BuiltContext {
  condition: Condition;
  messages: ChatMessage[];             // context + final question
  message_ids: string[];               // scenario message ids, in context order
  tokens: number;                      // context tokens, question excluded
  question_tokens: number;
  budget: number;                      // ancestor tokens (B)
  ratio_to_budget: number;             // tokens / B
  starts_with_assistant: boolean;
  exposure: Exposure;
}

// --- production SQL (copy). Starts at the ask node; production starts at the
// new user message, which is the question we append, so the result is identical.
export async function ancestorRows(prisma: PrismaClient, nodeId: string): Promise<Row[]> {
  return prisma.$queryRaw<Row[]>`
    WITH RECURSIVE message_tree AS (
      SELECT m.id, m.session_id, m.parent_id, m.role, m.content, m.depth, m.branch_label, m.attachments, m.created_at
      FROM messages m
      WHERE m.id = ${nodeId}
      UNION ALL
      SELECT parent.id, parent.session_id, parent.parent_id, parent.role, parent.content, parent.depth,
             parent.branch_label, parent.attachments, parent.created_at
      FROM messages parent
      INNER JOIN message_tree mt ON parent.id = mt.parent_id
    )
    SELECT id, role::text AS role, content, depth, created_at
    FROM message_tree
    ORDER BY depth ASC;
  `;
}

export async function sessionRows(prisma: PrismaClient, sid: string, before: Date): Promise<Row[]> {
  const rows = await prisma.message.findMany({
    where: { sessionId: sid, createdAt: { lt: before } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, role: true, content: true, depth: true, createdAt: true }
  });
  return rows.map((r) => ({ id: r.id, role: r.role as Row['role'], content: r.content, depth: r.depth, created_at: r.createdAt }));
}

export function windowSelect(timeOrdered: Row[], budget: number, tok: (r: Row) => number): Row[] {
  const out: Row[] = [];
  let used = 0;
  for (let i = timeOrdered.length - 1; i >= 0; i--) {
    const t = tok(timeOrdered[i]);
    if (used + t > budget) break;
    out.unshift(timeOrdered[i]);
    used += t;
  }
  return out;
}

export async function buildAll(prisma: PrismaClient, s: Scenario, encoding = 'o200k_base'): Promise<BuiltContext[]> {
  const tokCache = new Map<string, number>();
  const tok = (r: Row) => {
    if (!tokCache.has(r.id)) tokCache.set(r.id, countTokens(r.content, encoding));
    return tokCache.get(r.id)!;
  };
  const sum = (rs: Row[]) => rs.reduce((n, r) => n + tok(r), 0);

  const anc = await ancestorRows(prisma, messageId(s, s.ask_node));
  const session = await sessionRows(prisma, sessionId(s), createdAtOf(s.ask_t));
  const budget = sum(anc);
  const win = windowSelect(session, budget, tok);

  // Map DB ids back to scenario message ids for exposure.
  const prefix = messageId(s, '');
  const toScenarioId = (id: string) => id.slice(prefix.length);
  const byMid = new Map(s.messages.map((m) => [m.id, m]));
  const activeIds = new Set(s.messages.filter((m) => m.branch === 'active').map((m) => m.id));
  const conflictValues = s.planted.map((p) => p.value).filter((v): v is string => !!v);
  const canaries = s.planted.flatMap((p) => p.canaries);
  const qTokens = countTokens(s.question, encoding);

  const make = (condition: Condition, rows: Row[]): BuiltContext => {
    const ids = rows.map((r) => toScenarioId(r.id));
    const text = rows.map((r) => r.content).join('\n');
    const sib = ids.filter((id) => !activeIds.has(id));
    const tokens = sum(rows);
    return {
      condition,
      messages: [...rows.map((r) => ({ role: r.role, content: r.content })), { role: 'user', content: s.question }],
      message_ids: ids,
      tokens,
      question_tokens: qTokens,
      budget,
      ratio_to_budget: budget ? tokens / budget : 0,
      starts_with_assistant: rows[0]?.role === 'assistant',
      exposure: {
        sibling_messages: sib,
        sibling_branches: [...new Set(sib.map((id) => byMid.get(id)!.branch))].sort(),
        canaries: canaries.filter((c) => containsTerm(text, c)),
        leak_values: conflictValues.filter((v) => containsTerm(text, v)),
        active_messages: ids.filter((id) => activeIds.has(id)).length,
        active_total: activeIds.size,
        required_fact_present: ids.includes(s.required_fact.message)
      }
    };
  };

  return [make('ancestor', anc), make('full_tree', session), make('window', win)];
}
