// Experiment runner: builds the three contexts from the experiment database and
// calls a pinned model through OpenRouter, one JSON line per call.
//
// Usage:
//   tsx runner/run.ts --model open_weights --file data/sample.jsonl --out results/raw/pilot-mistral.jsonl
//   tsx runner/run.ts ... --dry            build contexts + project cost, no API calls
//   options: --limit N (scenarios), --conditions ancestor,window, --concurrency 4,
//            --repeat-fraction 0.1 --repeats 3 (variance repeats), --cap-usd N
//
// Safety: guard first (experiment DB only). Resume: lines already logged with
// ok=true are skipped, so re-running continues where it stopped. Cost cap: the
// spend already logged in results/raw/*.jsonl plus the estimate of in-flight and
// next calls may never exceed the cap; the run stops scheduling before it would.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, loadConfig } from '../lib/config.js';
import { guarded } from '../lib/env.js';
import { readJsonl } from '../generator/validate.js';
import { hashString } from '../lib/rng.js';
import { countTokens } from '../builders/tokens.js';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_SHA256 } from './system_prompt.js';
import { callOpenRouter, requestBody, type ModelSpec } from './openrouter.js';
import type { Condition } from '../builders/context.js';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry');

function readLines(path: string): any[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function jobKey(scenario: string, condition: string, model: string, rep: number) {
  return `${scenario}|${condition}|${model}|${rep}`;
}

function costOf(spec: ModelSpec, inTok: number, outTok: number) {
  return (inTok * spec.price.in + outTok * spec.price.out) / 1e6;
}

await guarded(async () => {
  const cfg: any = loadConfig();
  const m = cfg.models;
  const which = flag('--model') ?? 'open_weights';
  const spec: ModelSpec | undefined = m.under_test.find((x: ModelSpec) => x.role === which || x.id === which);
  if (!spec) throw new Error(`unknown model "${which}"; use a role (${m.under_test.map((x: ModelSpec) => x.role).join(', ')}) or id`);

  const file = flag('--file') ?? join(ROOT, 'data/sample.jsonl');
  const out = flag('--out') ?? join(ROOT, `results/raw/${spec.role}.${basename(file, '.jsonl')}.jsonl`);
  const conditions = (flag('--conditions') ?? 'ancestor,full_tree,window').split(',') as Condition[];
  const concurrency = Number(flag('--concurrency') ?? 4);
  const cap = Number(flag('--cap-usd') ?? cfg.cost_cap_usd);
  const repeatFraction = Number(flag('--repeat-fraction') ?? 0);
  const repeats = Number(flag('--repeats') ?? 1);
  let scenarios = readJsonl(file);
  if (flag('--limit')) scenarios = scenarios.slice(0, Number(flag('--limit')));
  // Targeted re-run: only these job keys ("scenario|condition|rep"), with an
  // optional higher output cap. Each re-run line records what it supersedes.
  const maxTokens = Number(flag('--max-tokens') ?? m.max_output_tokens);
  const onlyKeysFile = flag('--only-keys');
  const onlyKeys = onlyKeysFile ? new Set<string>(JSON.parse(readFileSync(onlyKeysFile, 'utf8'))) : null;
  const rerunReason = flag('--rerun-reason') ?? null;
  if (onlyKeys) scenarios = scenarios.filter((s) => [...onlyKeys].some((k) => k.startsWith(`${s.id}|`)));

  // ---- resume + global spend ----
  const done = new Set(readLines(out).filter((r) => r.ok).map((r) => jobKey(r.scenario, r.condition, r.model, r.rep)));
  const rawDir = join(ROOT, 'results/raw');
  const spentBefore = existsSync(rawDir)
    ? readdirSync(rawDir).filter((f) => f.endsWith('.jsonl'))
        .flatMap((f) => readLines(join(rawDir, f))).reduce((s, r) => s + (r.cost_usd ?? 0), 0)
    : 0;

  const { prisma } = await import('../../server/src/prismaClient.js');
  const { buildAll } = await import('../builders/context.js');
  const sysTokens = countTokens(SYSTEM_PROMPT, cfg.tokens.reference_encoding);
  const EST_OUT = Math.min(maxTokens, onlyKeys ? 3000 : 300); // planning estimate for output tokens (incl. reasoning)
  const IN_MARGIN = 1.15;   // tokenizer differences vs the reference tokenizer

  type Job = { s: any; ctx: any; rep: number; estUsd: number };
  const jobs: Job[] = [];
  try {
    for (const s of scenarios) {
      const built = await buildAll(prisma, s, cfg.tokens.reference_encoding);
      const nReps = repeatFraction > 0 && (hashString(`rep|${s.id}`) % 1000) / 1000 < repeatFraction ? repeats : 1;
      for (const ctx of built) {
        if (!conditions.includes(ctx.condition)) continue;
        for (let rep = 0; rep < nReps; rep++) {
          if (done.has(jobKey(s.id, ctx.condition, spec.id, rep))) continue;
          if (onlyKeys && !onlyKeys.has(`${s.id}|${ctx.condition}|${rep}`)) continue;
          const inTok = (sysTokens + ctx.tokens + ctx.question_tokens) * IN_MARGIN;
          jobs.push({ s, ctx, rep, estUsd: costOf(spec, inTok, EST_OUT) });
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const projected = jobs.reduce((a, j) => a + j.estUsd, 0);
  console.log(`model ${spec.id} @ ${spec.provider} | temperature ${spec.temperature ?? 'provider default'} | reasoning ${m.reasoning_effort} | max_tokens ${maxTokens}${onlyKeys ? ` | re-run of ${onlyKeys.size} keys (${rerunReason})` : ''}`);
  console.log(`${scenarios.length} scenarios, conditions ${conditions.join('/')}: ${jobs.length} calls to make, ${done.size} already done (resume)`);
  console.log(`spend so far (all results/raw): $${spentBefore.toFixed(4)} | projected for this run: $${projected.toFixed(4)} | cap: $${cap}`);
  if (DRY) {
    const ex = jobs[0];
    if (ex) {
      const body = requestBody({
        model: spec, maxTokens, reasoningEffort: m.reasoning_effort, allowFallbacks: m.allow_fallbacks,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...ex.ctx.messages]
      });
      console.log(`dry run: no API calls. Example request (first job, messages elided):`);
      console.log(JSON.stringify({ ...body, messages: `[${(body.messages as any[]).length} messages]` }, null, 2));
    }
    return;
  }
  if (spentBefore + projected > cap) {
    console.error(`REFUSED: spend so far + projected ($${(spentBefore + projected).toFixed(2)}) exceeds the cap ($${cap}).`);
    process.exit(3);
  }

  // ---- run ----
  mkdirSync(dirname(out), { recursive: true });
  const runId = randomUUID();
  let spent = spentBefore;
  let reserved = 0;
  let next = 0;
  let ok = 0, failed = 0, aborted = false;

  const worker = async () => {
    while (true) {
      if (aborted || next >= jobs.length) return;
      const job = jobs[next++];
      if (spent + reserved + job.estUsd > cap) { aborted = true; return; }
      reserved += job.estUsd;
      const messages = [{ role: 'system' as const, content: SYSTEM_PROMPT }, ...job.ctx.messages];
      const started = new Date();
      const r = await callOpenRouter({
        model: spec, messages, maxTokens,
        reasoningEffort: m.reasoning_effort, allowFallbacks: m.allow_fallbacks
      });
      const ended = new Date();
      reserved -= job.estUsd;
      const cost = r.usage.cost_usd ?? (r.ok ? costOf(spec, r.usage.prompt_tokens ?? 0, r.usage.completion_tokens ?? 0) : 0);
      spent += cost;
      const c = job.ctx;
      appendFileSync(out, JSON.stringify({
        run_id: runId,
        scenario: job.s.id,
        variables: job.s.variables,
        condition: c.condition,
        rep: job.rep,
        model: spec.id,
        model_role: spec.role,
        provider_requested: spec.provider,
        provider_reported: r.provider,
        model_reported: r.model_reported,
        generation_id: r.generation_id,
        params: { temperature: spec.temperature, seed: spec.seed, max_tokens: maxTokens, reasoning_effort: m.reasoning_effort, allow_fallbacks: m.allow_fallbacks },
        system_prompt_sha256: SYSTEM_PROMPT_SHA256,
        messages,
        message_ids: c.message_ids,
        response: r.text,
        finish_reason: r.finish_reason,
        usage: r.usage,
        cost_usd: cost,
        cost_source: r.usage.cost_usd !== null ? 'openrouter' : 'computed',
        est_cost_usd: job.estUsd,
        ref_tokens: { system: sysTokens, context: c.tokens, question: c.question_tokens, budget: c.budget },
        window_ratio: c.ratio_to_budget,
        starts_with_assistant: c.starts_with_assistant,
        exposure: c.exposure,
        rerun: onlyKeys ? { supersedes_key: `${job.s.id}|${c.condition}|${job.rep}`, reason: rerunReason } : null,
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        latency_ms: ended.getTime() - started.getTime(),
        attempts: r.attempts,
        ok: r.ok,
        status: r.status,
        error: r.error
      }) + '\n');
      if (r.ok) ok++; else failed++;
      const n = ok + failed;
      if (n % 10 === 0 || n === jobs.length)
        console.log(`  ${n}/${jobs.length} done (${ok} ok, ${failed} failed), spend $${spent.toFixed(4)}`);
      if (!r.ok) console.log(`  FAILED ${job.s.id} ${c.condition}: ${r.error}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  console.log(`finished: ${ok} ok, ${failed} failed${aborted ? ', STOPPED at cost cap' : ''}; total spend $${spent.toFixed(4)}; log ${out}`);
  if (aborted) process.exitCode = 4;
});
