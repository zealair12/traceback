// Targeted re-run by REPLAY: re-send the exact logged messages of selected calls
// with a different output cap, and log new lines that record what they supersede.
// No database needed: the prompt is byte-identical to the original call.
//
// Usage:
//   tsx runner/rerun.ts --from results/raw/open_weights.jsonl \
//     --keys results/reruns/open_weights.maxtokens4096.keys.json \
//     --out results/raw/open_weights.rerun-maxtokens4096.jsonl \
//     --max-tokens 4096 --reason "..." [--dry] [--concurrency 4]
// Keys are "scenario|condition|rep". Resumes: keys already logged ok are skipped.

import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ROOT, loadConfig } from '../lib/config.js';
import { guarded } from '../lib/env.js';
import { callOpenRouter, type ModelSpec } from './openrouter.js';
import { SYSTEM_PROMPT_SHA256 } from './system_prompt.js';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const need = (n: string) => { const v = flag(n); if (!v) throw new Error(`missing ${n}`); return v; };
const readLines = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const key = (r: any) => `${r.scenario}|${r.condition}|${r.rep}`;

await guarded(async () => {
  const cfg: any = loadConfig();
  const from = need('--from'), out = need('--out');
  const keys = new Set<string>(JSON.parse(readFileSync(need('--keys'), 'utf8')));
  const maxTokens = Number(need('--max-tokens'));
  const reason = flag('--reason') ?? null;
  const concurrency = Number(flag('--concurrency') ?? 4);
  const cap = Number(cfg.cost_cap_usd);

  const originals = readLines(from).filter((r) => keys.has(key(r)));
  const done = new Set(readLines(out).filter((r) => r.ok).map(key));
  const todo = originals.filter((r) => !done.has(key(r)));
  if (originals.length !== keys.size) throw new Error(`found ${originals.length} of ${keys.size} keys in ${from}`);
  if (new Set(originals.map((r) => r.model)).size !== 1) throw new Error('keys span more than one model');
  for (const r of originals) if (r.system_prompt_sha256 !== SYSTEM_PROMPT_SHA256) throw new Error(`system prompt changed since ${key(r)}`);

  const spec: ModelSpec | undefined = cfg.models.under_test.find((x: ModelSpec) => x.id === originals[0].model);
  if (!spec) throw new Error(`model ${originals[0].model} not in config`);
  const rawDir = join(ROOT, 'results/raw');
  const spent0 = readdirSync(rawDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readLines(join(rawDir, f))).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const est = (r: any) => ((r.usage.prompt_tokens ?? 1500) * spec.price.in + Math.min(maxTokens, 3000) * spec.price.out) / 1e6;
  const projected = todo.reduce((s, r) => s + est(r), 0);
  console.log(`replay ${todo.length}/${originals.length} calls of ${spec.id} @ ${spec.provider} with max_tokens ${maxTokens} (${reason})`);
  console.log(`spend so far $${spent0.toFixed(4)} | projected $${projected.toFixed(4)} | cap $${cap}`);
  if (args.includes('--dry')) return;
  if (spent0 + projected > cap) { console.error('REFUSED: would exceed cost cap'); process.exit(3); }

  const runId = randomUUID();
  let next = 0, ok = 0, failed = 0, spent = spent0;
  const worker = async () => {
    while (next < todo.length) {
      const o = todo[next++];
      const started = new Date();
      const r = await callOpenRouter({
        model: spec, messages: o.messages, maxTokens,
        reasoningEffort: o.params.reasoning_effort, allowFallbacks: o.params.allow_fallbacks
      });
      const ended = new Date();
      const cost = r.usage.cost_usd ?? 0;
      spent += cost;
      appendFileSync(out, JSON.stringify({
        ...o,                                   // same scenario, condition, rep, messages, exposure, ref tokens
        run_id: runId,
        provider_reported: r.provider,
        model_reported: r.model_reported,
        generation_id: r.generation_id,
        params: { ...o.params, max_tokens: maxTokens },
        response: r.text,
        finish_reason: r.finish_reason,
        usage: r.usage,
        cost_usd: cost,
        cost_source: r.usage.cost_usd !== null ? 'openrouter' : 'computed',
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        latency_ms: ended.getTime() - started.getTime(),
        attempts: r.attempts,
        ok: r.ok,
        status: r.status,
        error: r.error,
        rerun: {
          supersedes_key: key(o),
          supersedes_generation_id: o.generation_id,
          supersedes_file: from,
          reason,
          messages_sha256: createHash('sha256').update(JSON.stringify(o.messages)).digest('hex')
        }
      }) + '\n');
      if (r.ok) ok++; else { failed++; console.log(`  FAILED ${key(o)}: ${r.error}`); }
      if ((ok + failed) % 10 === 0 || ok + failed === todo.length) console.log(`  ${ok + failed}/${todo.length} (${ok} ok, ${failed} failed) spend $${spent.toFixed(4)}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`finished: ${ok} ok, ${failed} failed; log ${out}`);
});
