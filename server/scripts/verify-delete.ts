// Verifies the "delete a message and its whole subtree" behaviour.
//
// Plain-English: we build a small conversation tree, then delete one branch and
// confirm that exactly that branch (the chosen message and everything beneath
// it) disappears, while the rest of the tree is untouched. This guards the bug
// where the delete query compared a text id against a uuid and always failed.

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// The exact subtree-delete query the DELETE /messages/:id endpoint runs.
async function deleteSubtree(id: string) {
  await prisma.$executeRaw(Prisma.sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM messages WHERE id = ${id}
      UNION ALL
      SELECT m.id FROM messages m INNER JOIN subtree s ON m.parent_id = s.id
    )
    DELETE FROM messages WHERE id IN (SELECT id FROM subtree);
  `);
}

async function main() {
  const session = await prisma.session.create({ data: { name: 'delete-verify' } });
  const mk = (content: string, parentId: string | null, depth: number) =>
    prisma.message.create({ data: { sessionId: session.id, parentId, role: 'user', content, depth } });

  // Tree:  Root -> A -> A1   and   Root -> B
  const root = await mk('Root', null, 0);
  const a = await mk('A', root.id, 1);
  const a1 = await mk('A1', a.id, 2);
  const b = await mk('B', root.id, 1);

  // Delete branch A (should remove A and A1, keep Root and B).
  await deleteSubtree(a.id);

  const remaining = await prisma.message.findMany({
    where: { sessionId: session.id },
    select: { content: true },
  });
  const names = remaining.map((m) => m.content).sort();
  console.log('messages remaining after deleting branch A:', names);

  const ok = JSON.stringify(names) === JSON.stringify(['B', 'Root']);

  // Clean up.
  await prisma.message.deleteMany({ where: { sessionId: session.id } });
  await prisma.session.delete({ where: { id: session.id } });

  if (!ok) {
    console.error('FAILED: expected only Root and B to remain.');
    process.exit(1);
  }
  console.log('PASSED: deleting a branch removes it and its descendants only.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
