// Headless verification of the core Traceback idea: context pruning by lineage.
//
// Plain-English summary of what this proves:
// A conversation is stored as a TREE of messages. When you are sitting on one
// branch and ask a question, the model should only see the messages on the path
// from the very first message (the root) down to where you are -- NOT the
// messages on other, unrelated branches. This script builds a small tree with
// two separate branches and checks that each branch only "sees" its own path.
//
// It talks straight to the database and runs the same recursive query the app
// uses, so it does NOT need the Groq LLM key. That lets us verify the heart of
// the system locally.

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// The exact recursive query the app uses to walk from a node up to the root.
async function lineageOf(messageId: string) {
  return prisma.$queryRaw<Array<{ content: string; depth: number }>>(Prisma.sql`
    WITH RECURSIVE message_tree AS (
      SELECT m.id, m.parent_id, m.content, m.depth
      FROM messages m WHERE m.id = ${messageId}
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.content, parent.depth
      FROM messages parent
      INNER JOIN message_tree mt ON parent.id = mt.parent_id
    )
    SELECT content, depth FROM message_tree ORDER BY depth ASC;
  `);
}

async function main() {
  // Fresh session so repeated runs do not interfere with each other.
  const session = await prisma.session.create({ data: { name: 'lineage-verify' } });

  // Build this shape:
  //        Root
  //        /  \
  //   Branch A  Branch B
  const root = await prisma.message.create({
    data: { sessionId: session.id, parentId: null, role: 'user', content: 'Root', depth: 0 },
  });
  const branchA = await prisma.message.create({
    data: { sessionId: session.id, parentId: root.id, role: 'user', content: 'Branch A', depth: 1 },
  });
  const branchB = await prisma.message.create({
    data: { sessionId: session.id, parentId: root.id, role: 'user', content: 'Branch B', depth: 1 },
  });

  const lineageA = (await lineageOf(branchA.id)).map((m) => m.content);
  const lineageB = (await lineageOf(branchB.id)).map((m) => m.content);

  console.log('Lineage seen from Branch A:', lineageA);
  console.log('Lineage seen from Branch B:', lineageB);

  const expectedA = ['Root', 'Branch A'];
  const expectedB = ['Root', 'Branch B'];
  const ok =
    JSON.stringify(lineageA) === JSON.stringify(expectedA) &&
    JSON.stringify(lineageB) === JSON.stringify(expectedB);

  // Clean up the test data so the database stays tidy.
  await prisma.message.deleteMany({ where: { sessionId: session.id } });
  await prisma.session.delete({ where: { id: session.id } });

  if (!ok) {
    console.error('FAILED: lineage pruning did not return the expected path-to-root.');
    process.exit(1);
  }
  console.log('PASSED: each branch sees only its own path to the root (context is pruned).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
