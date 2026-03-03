// Simple headless integration test for the TraceBack backend.
// This script:
// - Creates a new session via the Express API.
// - Sends a root message.
// - Sends two child messages branching from the same root.
// - Verifies that the `lineage` returned for each branch contains
//   only its own linear path (root -> that node), demonstrating that
//   the recursive CTE correctly prunes context.
//
// Run with:
//   cd server
//   npx ts-node-dev scripts/test-tree.ts
//
// The server must already be running (e.g. `npm run dev`).

import axios from 'axios';

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:4000';

interface SendMessageResponse {
  userMessage: {
    id: string;
    sessionId: string;
    parentId: string | null;
  };
  assistantMessage: {
    id: string;
    sessionId: string;
    parentId: string | null;
  };
  lineage: Array<{
    id: string;
    parent_id: string | null;
    content: string;
    depth: number;
  }>;
}

async function main() {
  console.log('Starting TraceBack tree test against', BASE_URL);

  // 1) Create a session.
  const sessionRes = await axios.post(`${BASE_URL}/sessions`, {
    name: 'Test session for recursive CTE'
  });
  const session = sessionRes.data as { id: string };
  console.log('Created session:', session.id);

  // 2) Root message.
  const rootRes = await axios.post<SendMessageResponse>(`${BASE_URL}/message/send`, {
    session_id: session.id,
    parent_id: null,
    content: 'Root Message'
  });
  const root = rootRes.data.userMessage;
  console.log('Root message ID:', root.id);

  // 3) Child A (Message 2) from Root.
  const childARes = await axios.post<SendMessageResponse>(`${BASE_URL}/message/send`, {
    session_id: session.id,
    parent_id: root.id,
    content: 'Child A from Root'
  });
  const childA = childARes.data.userMessage;
  const lineageA = childARes.data.lineage;

  // 4) Child B (Message 3) also from Root (branch).
  const childBRes = await axios.post<SendMessageResponse>(`${BASE_URL}/message/send`, {
    session_id: session.id,
    parent_id: root.id,
    content: 'Child B from Root'
  });
  const childB = childBRes.data.userMessage;
  const lineageB = childBRes.data.lineage;

  // --- Validation ------------------------------------------------------------

  const idsA = lineageA.map((m) => m.id);
  const idsB = lineageB.map((m) => m.id);

  const expectedA = [root.id, childA.id];
  const expectedB = [root.id, childB.id];

  console.log('Lineage for Child A:', idsA);
  console.log('Expected for Child A:', expectedA);

  console.log('Lineage for Child B:', idsB);
  console.log('Expected for Child B:', expectedB);

  const okA = idsA.length === expectedA.length && idsA.every((id, i) => id === expectedA[i]);
  const okB = idsB.length === expectedB.length && idsB.every((id, i) => id === expectedB[i]);

  if (!okA || !okB) {
    console.error('❌ Recursive CTE lineage validation FAILED.');
    process.exitCode = 1;
    return;
  }

  console.log('✅ Recursive CTE lineage validation PASSED.');
}

main().catch((err) => {
  console.error('Test script failed:', err);
  process.exitCode = 1;
});

