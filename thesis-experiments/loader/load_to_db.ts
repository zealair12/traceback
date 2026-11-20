// Load scenarios into the EXPERIMENT database as normal Traceback rows, using the
// app's own Prisma client (server/src/prismaClient.ts) and schema.
//
// Usage:
//   tsx loader/load_to_db.ts [--file data/sample.jsonl]    load (idempotent)
//   tsx loader/load_to_db.ts --reset                       delete ONLY experiment rows
//   tsx loader/load_to_db.ts --assign-owner latest         hand experiment sessions to the
//                                                          most recently created real user
//                                                          (after you log in locally once)
//
// Namespacing: every session id is "exp-<scenario id>" and every message id is
// "exp-<scenario id>-<message id>", owned by a dedicated experiment user. App
// session ids are UUIDs, so the "exp-" prefix can never match a real session.
// Loading a scenario deletes and re-inserts that one session in a transaction,
// so re-running gives identical rows.

import { join } from 'node:path';
import { ROOT } from '../lib/config.js';
import { guarded } from '../lib/env.js';
import { readJsonl } from '../generator/validate.js';
import { SESSION_PREFIX, EXP_USER, sessionId, messageId, createdAtOf, depthMap } from './shared.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

await guarded(async () => {
  // Import the app's Prisma client only now, after the guard set DATABASE_URL.
  const { prisma } = await import('../../server/src/prismaClient.js');
  try {
    if (args.includes('--reset')) {
      const del = await prisma.session.deleteMany({ where: { id: { startsWith: SESSION_PREFIX } } });
      const u = await prisma.user.deleteMany({ where: { googleId: EXP_USER.googleId } });
      console.log(`reset: deleted ${del.count} experiment sessions (messages cascade) and ${u.count} experiment user`);
      return;
    }

    if (flag('--assign-owner')) {
      const owner = await prisma.user.findFirst({
        where: { googleId: { not: EXP_USER.googleId } },
        orderBy: { createdAt: 'desc' }
      });
      if (!owner) throw new Error('no real user yet: log in to local Traceback once with this database, then retry');
      const r = await prisma.session.updateMany({ where: { id: { startsWith: SESSION_PREFIX } }, data: { userId: owner.id, guestId: null } });
      console.log(`assigned ${r.count} experiment sessions to user ${owner.id}`);
      return;
    }

    const file = flag('--file') ?? join(ROOT, 'data/sample.jsonl');
    const scenarios = readJsonl(file);
    const user = await prisma.user.upsert({
      where: { googleId: EXP_USER.googleId },
      update: {},
      create: EXP_USER
    });

    let msgs = 0;
    for (const s of scenarios) {
      const depth = depthMap(s);
      const ordered = [...s.messages].sort((a, b) => a.t - b.t); // parents before children
      await prisma.$transaction(async (tx) => {
        // Keep whichever owner the session currently has (e.g. after --assign-owner).
        const existing = await tx.session.findUnique({ where: { id: sessionId(s) }, select: { userId: true } });
        await tx.session.deleteMany({ where: { id: sessionId(s) } });
        await tx.session.create({
          data: {
            id: sessionId(s),
            name: `exp:${s.id}`,
            userId: existing?.userId ?? user.id,
            createdAt: createdAtOf(-1)
          }
        });
        await tx.message.createMany({
          data: ordered.map((m) => ({
            id: messageId(s, m.id),
            sessionId: sessionId(s),
            parentId: m.parent === null ? null : messageId(s, m.parent),
            role: m.role,
            content: m.text,
            depth: depth.get(m.id)!,
            branchLabel: m.branch,
            createdAt: createdAtOf(m.t)
          }))
        });
      });
      msgs += s.messages.length;
    }
    console.log(`loaded ${scenarios.length} scenarios, ${msgs} messages from ${file}`);
  } finally {
    await prisma.$disconnect();
  }
});
