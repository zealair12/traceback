// End-to-end check of the conversation importer, no API key needed.
//
// Plain-English: this proves the whole migration path on a synthetic ChatGPT
// export file that contains the tricky cases (a hidden system note, an internal
// tool step, and a real branch from an edited message):
//   1. The parser keeps only the visible user/assistant turns, reattaches
//      children across skipped plumbing nodes, and preserves the branch.
//   2. POST /import writes the trees to the database intact.
//   3. An imported branch can be CONTINUED with a (mock) model -- the point of
//      the whole feature: history from another product, alive in Traceback.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseImportFile, parseImportText, conversationStats } from '../../packages/traceback-shared/src/importers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, '..', 'src', 'index.ts');
const fixturePath = join(__dirname, 'fixtures', 'chatgpt-export.json');
const claudeFixturePath = join(__dirname, 'fixtures', 'claude-code-session.jsonl');

function startMockModelServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'continued by mock model' } }] }));
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as any).port, close: () => server.close() })
    );
  });
}

async function waitForHealth(base: string, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not become healthy in time.');
}

async function main() {
  // --- Step 1: parse the fixture and check the normalized structure ----------
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const { importerId, conversations } = parseImportFile(raw);
  console.log('importer detected:', importerId, '| conversations:', conversations.length);

  const conv1 = conversations[0];
  const stats1 = conversationStats(conv1);
  console.log('conv1 messages:', stats1.messageCount, '| branch points:', stats1.branchCount);

  const byId = new Map(conv1.messages.map((m) => [m.id, m]));
  const parseOk =
    importerId === 'chatgpt' &&
    conversations.length === 2 &&
    stats1.messageCount === 6 && // system + tool + empty-root skipped
    stats1.branchCount === 1 && // a1 has two children (the edit branch)
    byId.get('u1')?.parentId === null && // system node skipped, root reattached
    byId.get('a2a')?.parentId === 'u2a' && // tool node skipped, child reattached
    byId.get('u2a')?.parentId === 'a1' &&
    byId.get('u2b')?.parentId === 'a1' &&
    byId.get('a1')?.model === 'gpt-4o' &&
    byId.get('a2b')?.model === 'gpt-4-turbo';
  console.log('parser checks:', parseOk ? 'ok' : 'FAILED');
  if (!parseOk) process.exit(1);

  // --- Step 1b: parse the Claude Code session fixture (.jsonl) ---------------
  const claudeParsed = parseImportText(readFileSync(claudeFixturePath, 'utf8'));
  const cc = claudeParsed.conversations[0];
  const ccStats = conversationStats(cc);
  const ccById = new Map(cc.messages.map((m) => [m.id, m]));
  console.log(
    'claude-code fixture:',
    claudeParsed.importerId,
    '| name:',
    JSON.stringify(cc.name),
    '| messages:',
    ccStats.messageCount,
    '| branches:',
    ccStats.branchCount
  );
  const claudeOk =
    claudeParsed.importerId === 'claude-code' &&
    cc.name === 'Fixture: refactor the parser' &&
    ccStats.messageCount === 6 && // thinking/tool/sidechain/command lines all skipped
    ccStats.branchCount === 1 && // the retry branch under the merged reply
    // two assistant text segments separated by tool activity merged into one
    ccById.get('a1')?.content.includes('I will start by reading the parser.') === true &&
    ccById.get('a1')?.content.includes('Done. The parser is now split into two functions.') === true &&
    // the branch siblings both hang off the merged assistant reply
    ccById.get('u2a')?.parentId === 'a1' &&
    ccById.get('u2b')?.parentId === 'a1' &&
    // provenance: which Claude model answered, recorded per message
    ccById.get('a3b')?.model === 'claude-test-2' &&
    ccById.get('a3b')?.provider === 'anthropic' &&
    // sidechain (subagent) content must never be imported
    !cc.messages.some((m) => m.content.includes('subagent internal prompt'));
  console.log('claude-code parser checks:', claudeOk ? 'ok' : 'FAILED');
  if (!claudeOk) process.exit(1);

  // --- Step 2: import over HTTP and check the stored tree --------------------
  const mock = await startMockModelServer();
  const PORT = 4558;
  const base = `http://127.0.0.1:${PORT}`;
  const child = spawn('npx', ['tsx', serverEntry], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      LLM_PROVIDER: 'local',
      LOCAL_BASE_URL: `http://127.0.0.1:${mock.port}/v1`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  const cleanup = () => {
    child.kill('SIGTERM');
    mock.close();
  };

  try {
    await waitForHealth(base);

    const importResp = await fetch(`${base}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversations })
    });
    const importBody = await importResp.json();
    console.log('POST /import status:', importResp.status, '| sessions created:', importBody.imported?.length);

    const sessionId = importBody.imported[0].sessionId;
    const stored = await fetch(`${base}/sessions/${sessionId}/messages`).then((r) => r.json());
    const storedByContent = new Map(stored.map((m: any) => [m.content, m]));
    const a1s = storedByContent.get('A database is an organized collection of data.') as any;
    const branchChildren = stored.filter((m: any) => m.parentId === a1s?.id);
    console.log('stored messages:', stored.length, '| children at branch point:', branchChildren.length);
    console.log('stored provenance on a1:', a1s?.provider, '/', a1s?.model);

    // Also import the Claude Code conversation and confirm it stores intact.
    const ccResp = await fetch(`${base}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversations: claudeParsed.conversations })
    });
    const ccBody = await ccResp.json();
    const ccStored = await fetch(`${base}/sessions/${ccBody.imported?.[0]?.sessionId}/messages`).then((r) => r.json());
    console.log('claude-code import status:', ccResp.status, '| stored messages:', ccStored.length);

    // --- Step 3: continue an imported branch with the mock model -------------
    const a2b = storedByContent.get('SQL stores tables; NoSQL stores documents.') as any;
    const cont = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        parent_id: a2b?.id,
        content: 'Continue this imported thread please',
        provider: 'local'
      })
    });
    const contBody = await cont.json();
    console.log(
      'continue imported branch status:',
      cont.status,
      '| reply:',
      JSON.stringify(contBody.assistantMessage?.content),
      '| lineage length:',
      contBody.lineage?.length
    );

    const ok =
      importResp.status === 201 &&
      importBody.imported.length === 2 &&
      ccResp.status === 201 &&
      ccStored.length === 6 &&
      stored.length === 6 &&
      branchChildren.length === 2 &&
      a1s?.provider === 'openai' &&
      a1s?.model === 'gpt-4o' &&
      cont.status === 201 &&
      contBody.assistantMessage?.content === 'continued by mock model' &&
      // lineage = u1, a1, u2b, a2b, new user turn (pruned: the u2a branch is absent)
      contBody.lineage?.length === 5;

    cleanup();
    if (!ok) {
      console.error('FAILED: import flow did not behave as expected.');
      process.exit(1);
    }
    console.log('PASSED: parse, import, branch preservation, and continuing an imported branch all work.');
  } catch (e) {
    cleanup();
    console.error(e);
    process.exit(1);
  }
}

main();
