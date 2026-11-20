// Phase 2 acceptance: compare the experiment database against the scenario file.
// Checks row counts, parent links, depth, role, content, branch label, and that
// createdAt follows the logical clock. Read-only.
// Usage: tsx loader/verify_load.ts [--file data/sample.jsonl]

import { join } from 'node:path';
import { ROOT } from '../lib/config.js';
import { guarded } from '../lib/env.js';
import { readJsonl } from '../generator/validate.js';
import { SESSION_PREFIX, sessionId, messageId, createdAtOf, depthMap } from './shared.js';

const args = process.argv.slice(2);
const fi = args.indexOf('--file');
const file = fi >= 0 ? args[fi + 1] : join(ROOT, 'data/sample.jsonl');

await guarded(async () => {
  const { prisma } = await import('../../server/src/prismaClient.js');
  try {
    const scenarios = readJsonl(file);
    const errs: string[] = [];
    let expectedMsgs = 0;
    for (const s of scenarios) {
      expectedMsgs += s.messages.length;
      const rows = await prisma.message.findMany({ where: { sessionId: sessionId(s) } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      if (rows.length !== s.messages.length) errs.push(`${s.id}: ${rows.length} rows, expected ${s.messages.length}`);
      const depth = depthMap(s);
      for (const m of s.messages) {
        const r = byId.get(messageId(s, m.id));
        if (!r) { errs.push(`${s.id}/${m.id}: missing`); continue; }
        const parent = m.parent === null ? null : messageId(s, m.parent);
        if (r.parentId !== parent) errs.push(`${s.id}/${m.id}: parent ${r.parentId} != ${parent}`);
        if (r.depth !== depth.get(m.id)) errs.push(`${s.id}/${m.id}: depth ${r.depth} != ${depth.get(m.id)}`);
        if (r.role !== m.role) errs.push(`${s.id}/${m.id}: role`);
        if (r.content !== m.text) errs.push(`${s.id}/${m.id}: content differs`);
        if (r.branchLabel !== m.branch) errs.push(`${s.id}/${m.id}: branch label`);
        if (r.createdAt.getTime() !== createdAtOf(m.t).getTime()) errs.push(`${s.id}/${m.id}: createdAt ${r.createdAt.toISOString()} != t=${m.t}`);
      }
      // createdAt order must equal logical-clock order
      const dbOrder = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((r) => r.id);
      const fileOrder = [...s.messages].sort((a, b) => a.t - b.t).map((m) => messageId(s, m.id));
      if (dbOrder.join() !== fileOrder.join()) errs.push(`${s.id}: createdAt order differs from logical clock`);
    }
    const sessions = await prisma.session.count({ where: { id: { startsWith: SESSION_PREFIX } } });
    const messages = await prisma.message.count({ where: { sessionId: { startsWith: SESSION_PREFIX } } });
    const other = await prisma.session.count({ where: { NOT: { id: { startsWith: SESSION_PREFIX } } } });
    console.log(`experiment sessions: ${sessions} (expected ${scenarios.length})`);
    console.log(`experiment messages: ${messages} (expected ${expectedMsgs})`);
    console.log(`non-experiment sessions in this database: ${other}`);
    if (sessions !== scenarios.length) errs.push('session count mismatch');
    if (messages !== expectedMsgs) errs.push('message count mismatch');
    errs.forEach((e) => console.error('FAIL ' + e));
    console.log(errs.length ? `${errs.length} problems` : 'all checks passed');
    if (errs.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
});
