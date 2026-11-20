// Database tests for the context builders (Phase 3 acceptance).
// Needs the experiment database loaded with data/sample.jsonl.
// Run: npm run test:db
//
// The key test: the experiment's ancestor builder returns exactly the rows the
// PRODUCTION code returns. Both production queries are taken from the app at
// test time, so if the app's SQL ever changes, this test notices:
//   (1) the chat-path CTE, extracted verbatim from server/src/services/messageService.ts
//   (2) the exported fetchLineageMessages() function, called directly

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadExperimentEnv } from '../../lib/env.js';
import { ROOT } from '../../lib/config.js';
import { readJsonl } from '../../generator/validate.js';
import { messageId } from '../../loader/shared.js';
import { countTokens } from '../../builders/tokens.js';
import type { Scenario } from '../../lib/types.js';

loadExperimentEnv([]); // guard first; throws on anything but the experiment DB

const { prisma } = await import('../../../server/src/prismaClient.js');
const { fetchLineageMessages } = await import('../../../server/src/services/messageService.js');
const { buildAll, ancestorRows } = await import('../../builders/context.js');

const scenarios: Scenario[] = readJsonl(join(ROOT, 'data/sample.jsonl'));

// Pull the chat-path CTE out of the app source: the WITH RECURSIVE block that
// starts from ${userMessage.id}, up to its ORDER BY.
function productionChatPathSql(): string {
  const src = readFileSync(join(ROOT, '../server/src/services/messageService.ts'), 'utf8');
  const blocks = [...src.matchAll(/WITH RECURSIVE[\s\S]*?ORDER BY depth ASC;/g)].map((m) => m[0]);
  const chat = blocks.find((b) => b.includes('${userMessage.id}'));
  assert.ok(chat, 'chat-path CTE not found in messageService.ts');
  return chat!.replace('${userMessage.id}', '$1');
}

function expectedPath(s: Scenario): string[] {
  const byId = new Map(s.messages.map((m) => [m.id, m]));
  const out: string[] = [];
  for (let cur = byId.get(s.ask_node); cur; cur = cur.parent ? byId.get(cur.parent) : undefined) out.unshift(cur.id);
  return out;
}

after(async () => { await prisma.$disconnect(); });

test('ancestor builder == production chat-path CTE (verbatim SQL) for every sample tree', async () => {
  const sql = productionChatPathSql();
  for (const s of scenarios) {
    const ask = messageId(s, s.ask_node);
    const prod = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ask);
    const ours = await ancestorRows(prisma, ask);
    assert.deepEqual(ours.map((r) => r.id), prod.map((r) => r.id), s.id);
  }
});

test('ancestor builder == app fetchLineageMessages() for every sample tree', async () => {
  for (const s of scenarios) {
    const ask = messageId(s, s.ask_node);
    const prod = await fetchLineageMessages(ask);
    const ours = await ancestorRows(prisma, ask);
    assert.deepEqual(ours.map((r) => [r.role, r.content]), prod.map((r) => [r.role, r.content]), s.id);
  }
});

test('ancestor builder == root-to-ask path in the scenario file', async () => {
  for (const s of scenarios) {
    const ours = await ancestorRows(prisma, messageId(s, s.ask_node));
    assert.deepEqual(ours.map((r) => r.id), expectedPath(s).map((id) => messageId(s, id)), s.id);
  }
});

test('full tree, window and question invariants', async () => {
  for (const s of scenarios) {
    const [anc, full, win] = await buildAll(prisma, s);
    const last = (c: typeof anc) => c.messages[c.messages.length - 1];
    for (const c of [anc, full, win]) assert.deepEqual(last(c), { role: 'user', content: s.question }, `${s.id} ${c.condition}`);
    // full tree: every message, in logical-clock order
    assert.deepEqual(full.message_ids, [...s.messages].sort((a, b) => a.t - b.t).map((m) => m.id), s.id);
    // ancestor never larger than full tree, never contains sibling content
    assert.ok(anc.tokens <= full.tokens, s.id);
    assert.equal(anc.exposure.sibling_messages.length, 0, s.id);
    assert.equal(anc.exposure.canaries.length, 0, s.id);
    // window: within budget, a time-ordered suffix of the session, and maximal
    assert.ok(win.tokens <= win.budget, s.id);
    const n = win.message_ids.length;
    assert.deepEqual(win.message_ids, full.message_ids.slice(full.message_ids.length - n), s.id);
    if (n < full.message_ids.length) {
      const prev = s.messages.find((m) => m.id === full.message_ids[full.message_ids.length - n - 1])!;
      assert.ok(win.tokens + countTokens(prev.text) > win.budget, `${s.id}: window not maximal`);
    }
  }
});
