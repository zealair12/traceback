import axios, { type AxiosResponse } from 'axios';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const BASE_URL = (process.env.TEST_BASE_URL ?? process.env.BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const OUT_DIR = path.resolve(process.cwd(), 'reports/performance');

interface DebugMetrics {
  pid: number;
  uptimeSec: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  counts: {
    sessions: number;
    messages: number;
  };
  timestamp: string;
}

interface PerfStep<T = unknown> {
  name: string;
  ms: number;
  status: number;
  ok: boolean;
  before: DebugMetrics;
  after: DebugMetrics;
  payload: T;
  note?: string;
}

function bytesToMB(v: number): string {
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

function deltaMB(a: number, b: number): string {
  const d = b - a;
  const sign = d >= 0 ? '+' : '-';
  return `${sign}${Math.abs(d / (1024 * 1024)).toFixed(2)} MB`;
}

async function getMetrics(): Promise<DebugMetrics> {
  const { data } = await axios.get<DebugMetrics>(`${BASE_URL}/debug/metrics`);
  return data;
}

async function measureStep<T>(
  name: string,
  fn: () => Promise<AxiosResponse<T>>
): Promise<PerfStep<T>> {
  const before = await getMetrics();
  const t0 = performance.now();
  const res = await fn();
  const ms = performance.now() - t0;
  const after = await getMetrics();
  return {
    name,
    ms,
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    before,
    after,
    payload: res.data,
    note:
      res.status >= 200 && res.status < 300
        ? undefined
        : typeof res.data === 'object' && res.data && 'error' in (res.data as Record<string, unknown>)
          ? String((res.data as Record<string, unknown>).error)
          : `HTTP ${res.status}`
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const startedAt = new Date();
  const warmup = await axios.get(`${BASE_URL}/health`);
  if (warmup.status !== 200) {
    throw new Error(`Health check failed with status ${warmup.status}`);
  }

  const initial = await getMetrics();

  const createSession = await measureStep('create_session', () =>
    axios.post(
      `${BASE_URL}/sessions`,
      {
        name: `Perf report ${startedAt.toISOString()}`
      },
      { validateStatus: () => true }
    )
  );

  if (!createSession.ok) {
    throw new Error(`Could not create session: ${createSession.note ?? createSession.status}`);
  }

  const sessionId = (createSession.payload as { id: string }).id;

  const listSessions = await measureStep('list_sessions', () =>
    axios.get(`${BASE_URL}/sessions`, { validateStatus: () => true })
  );

  const rootMessage = await measureStep('send_root_message', () =>
    axios.post(
      `${BASE_URL}/message/send`,
      {
        session_id: sessionId,
        parent_id: null,
        content: 'What is the purpose of a recursive CTE in this project?'
      },
      { validateStatus: () => true }
    )
  );

  const rootUserId = rootMessage.ok
    ? (rootMessage.payload as { userMessage: { id: string } }).userMessage.id
    : null;

  const branchMessage = rootUserId
    ? await measureStep('send_branch_message', () =>
        axios.post(
          `${BASE_URL}/message/send`,
          {
            session_id: sessionId,
            parent_id: rootUserId,
            content: 'Now explain the tradeoff in one concise paragraph.'
          },
          { validateStatus: () => true }
        )
      )
    : {
        name: 'send_branch_message',
        ms: 0,
        status: 0,
        ok: false,
        before: rootMessage.after,
        after: rootMessage.after,
        payload: { skipped: true },
        note: 'Skipped because root message creation failed.'
      };

  const fetchMessages = await measureStep('fetch_session_messages', () =>
    axios.get(`${BASE_URL}/sessions/${sessionId}/messages`, { validateStatus: () => true })
  );

  const deleteBranch = rootUserId
    ? await measureStep('delete_root_subtree', () =>
        axios.delete(`${BASE_URL}/messages/${rootUserId}`, { validateStatus: () => true })
      )
    : {
        name: 'delete_root_subtree',
        ms: 0,
        status: 0,
        ok: false,
        before: fetchMessages.after,
        after: fetchMessages.after,
        payload: { skipped: true },
        note: 'Skipped because no root subtree was created.'
      };

  const finalMetrics = await getMetrics();

  const steps = [createSession, listSessions, rootMessage, branchMessage, fetchMessages, deleteBranch];

  const summary = {
    startedAt: startedAt.toISOString(),
    baseUrl: BASE_URL,
    initial,
    finalMetrics,
    steps: steps.map((s) => ({
      name: s.name,
      ms: Number(s.ms.toFixed(2)),
      status: s.status,
      ok: s.ok,
      note: s.note ?? null,
      rssBefore: s.before.memory.rss,
      rssAfter: s.after.memory.rss,
      heapUsedBefore: s.before.memory.heapUsed,
      heapUsedAfter: s.after.memory.heapUsed,
      sessionsBefore: s.before.counts.sessions,
      sessionsAfter: s.after.counts.sessions,
      messagesBefore: s.before.counts.messages,
      messagesAfter: s.after.counts.messages
    }))
  };

  const tableRows = steps
    .map(
      (s) =>
        `| ${s.name} | ${s.ok ? 'yes' : 'no'} | ${s.status || '—'} | ${s.ms.toFixed(2)} ms | ${deltaMB(
          s.before.memory.heapUsed,
          s.after.memory.heapUsed
        )} | ${deltaMB(s.before.memory.rss, s.after.memory.rss)} | ${s.after.counts.sessions} | ${s.after.counts.messages} | ${s.note ?? ''} |`
    )
    .join('\n');

  const md = `# Traceback Performance Report

- Generated: ${startedAt.toISOString()}
- Target: \`${BASE_URL}\`
- Output directory: \`server/reports/performance/\`

## Server Snapshot

### Before run
- PID: \`${initial.pid}\`
- Uptime: \`${initial.uptimeSec}s\`
- RSS: \`${bytesToMB(initial.memory.rss)}\`
- Heap used: \`${bytesToMB(initial.memory.heapUsed)}\`
- Sessions: \`${initial.counts.sessions}\`
- Messages: \`${initial.counts.messages}\`

### After run
- PID: \`${finalMetrics.pid}\`
- Uptime: \`${finalMetrics.uptimeSec}s\`
- RSS: \`${bytesToMB(finalMetrics.memory.rss)}\`
- Heap used: \`${bytesToMB(finalMetrics.memory.heapUsed)}\`
- Sessions: \`${finalMetrics.counts.sessions}\`
- Messages: \`${finalMetrics.counts.messages}\`

## Step Timings

| Step | OK | HTTP | Duration | Heap delta | RSS delta | Sessions after | Messages after | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${tableRows}

## Notes

- \`send_root_message\` and \`send_branch_message\` include the LLM round-trip, so they are the most expensive operations.
- Memory numbers are sampled from the Traceback server via \`/debug/metrics\`.
- RSS reflects overall resident memory; heap used is usually the clearer signal for app allocations.
- The script cleans up the created message subtree, but keeps the created session row so session growth remains observable over time.
`;

  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `perf-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `perf-${stamp}.md`);
  const latestJsonPath = path.join(OUT_DIR, 'latest.json');
  const latestMdPath = path.join(OUT_DIR, 'latest.md');

  await Promise.all([
    writeFile(jsonPath, JSON.stringify(summary, null, 2), 'utf8'),
    writeFile(mdPath, md, 'utf8'),
    writeFile(latestJsonPath, JSON.stringify(summary, null, 2), 'utf8'),
    writeFile(latestMdPath, md, 'utf8')
  ]);

  console.log(`Performance report written to:\n- ${latestMdPath}\n- ${latestJsonPath}`);
}

main().catch((err) => {
  console.error('Performance report failed:', err);
  process.exitCode = 1;
});
