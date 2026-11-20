// LLM judge (Phase 6). Blind to condition and model; jobs run in a seeded random order.
// Usage:
//   tsx scoring/judge.ts --task quality [--pilot 30] [--out results/scored/judge_quality.jsonl] [--dry]
//   tsx scoring/judge.ts --task leak    [--pilot 15] [--out results/scored/judge_leak.jsonl]    [--dry]
// --pilot N: stratified sample of N (equal per model x condition where possible).
// Resumes (skips keys already judged ok). Cost cap counts results/raw + results/scored spend.

import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, loadConfig } from '../lib/config.js';
import { guarded } from '../lib/env.js';
import { Rng } from '../lib/rng.js';
import { readJsonl } from '../generator/validate.js';
import { callOpenRouter, type ModelSpec } from '../runner/openrouter.js';
import { loadResponses, responseKey } from './merge.js';
import { QUALITY_SYSTEM, LEAK_SYSTEM, qualityUser, leakUser, QUALITY_KEYS, LEAK_LABELS, PROMPTS_SHA256 } from './judge_prompts.js';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const task = flag('--task') as 'quality' | 'leak';
if (task !== 'quality' && task !== 'leak') throw new Error('--task quality|leak');
const pilot = flag('--pilot') ? Number(flag('--pilot')) : null;
const out = flag('--out') ?? join(ROOT, `results/scored/judge_${task}${pilot ? '.pilot' : ''}.jsonl`);
const concurrency = Number(flag('--concurrency') ?? 6);
const readLines = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);

function parseJson(text: string): any {
  const t = text.replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object');
  return JSON.parse(t.slice(a, b + 1));
}

function validate(task: string, j: any, terms: string[]): string | null {
  if (task === 'quality') {
    for (const k of QUALITY_KEYS) if (!Number.isInteger(j[k]) || j[k] < 1 || j[k] > 5) return `bad ${k}`;
    return null;
  }
  if (!j.terms || typeof j.terms !== 'object') return 'no terms';
  for (const t of terms) if (!LEAK_LABELS.has(j.terms[t])) return `bad label for ${t}`;
  const used = terms.some((t) => j.terms[t] === 'used');
  if ((j.overall === 'used') !== used) return 'overall inconsistent with term labels';
  return null;
}

await guarded(async () => {
  const cfg: any = loadConfig();
  const judge: ModelSpec = cfg.models.judge;
  const scen = new Map(readJsonl(join(ROOT, 'data/scenarios.jsonl')).map((s) => [s.id, s]));
  const scored = new Map(readLines(join(ROOT, 'results/scored/deterministic.jsonl')).map((x) => [x.key, x]));
  let rows = loadResponses().filter((r) => {
    const d = scored.get(responseKey(r));
    if (!d) throw new Error(`run scoring/score.ts first (${responseKey(r)} missing)`);
    if (d.no_answer) return false;
    return task === 'quality' ? true : d.needs_leak_judge;
  });

  const rng = new Rng(cfg.seed + (task === 'quality' ? 101 : 202));
  if (pilot) {
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const g = `${r.model_role}|${r.condition}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }
    const per = Math.ceil(pilot / groups.size);
    rows = [...groups.values()].flatMap((g) => rng.shuffle(g).slice(0, per)).slice(0, pilot);
  }
  rows = rng.shuffle(rows); // random, condition-blind order

  const done = new Set(readLines(out).filter((x) => x.ok).map((x) => x.key));
  const todo = rows.filter((r) => !done.has(responseKey(r)));

  const build = (r: any) => {
    const s = scen.get(r.scenario)!;
    if (task === 'quality') {
      // Active path = root .. ask_node from the scenario (identical to the ancestor context).
      const by = new Map(s.messages.map((m) => [m.id, m]));
      const path: any[] = [];
      for (let cur: any = by.get(s.ask_node); cur; cur = cur.parent ? by.get(cur.parent) : null) path.unshift(cur);
      return { system: QUALITY_SYSTEM, user: qualityUser(path.map((m) => ({ role: m.role, content: m.text })), s.question, r.response), terms: [] as string[] };
    }
    const terms = scored.get(responseKey(r))!.leaked_items_exposed as string[];
    return { system: LEAK_SYSTEM, user: leakUser(r.response, terms), terms };
  };

  // Spend so far = model calls (results/raw/*.jsonl, cost_usd) + judge calls
  // (results/scored/judge_*.jsonl, judge_cost_usd). deterministic.jsonl only
  // copies model costs, so it is not counted again.
  const filesIn = (d: string, prefix = '') =>
    existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.jsonl') && f.startsWith(prefix)).map((f) => join(ROOT, d, f)) : [];
  const rawSpend =
    filesIn('results/raw').flatMap(readLines).reduce((s, x) => s + (x.cost_usd ?? 0), 0) +
    filesIn('results/scored', 'judge_').flatMap(readLines).reduce((s, x) => s + (x.judge_cost_usd ?? 0), 0);
  const estOne = (r: any) => {
    const b = build(r);
    const inTok = (b.system.length + b.user.length) / 3.6;
    return (inTok * judge.price.in + 400 * judge.price.out) / 1e6;
  };
  const projected = todo.reduce((s, r) => s + estOne(r), 0);
  console.log(`judge ${judge.id} @ ${judge.provider} | task ${task}${pilot ? ` (pilot ${pilot})` : ''} | ${todo.length} to judge, ${done.size} already done`);
  console.log(`spend so far $${rawSpend.toFixed(2)} | projected $${projected.toFixed(2)} | cap $${cfg.cost_cap_usd}`);
  if (args.includes('--dry')) return;
  if (rawSpend + projected > cfg.cost_cap_usd) { console.error('REFUSED: would exceed the cost cap'); process.exit(3); }

  const runId = randomUUID();
  let next = 0, ok = 0, failed = 0, spent = 0;
  const worker = async () => {
    while (next < todo.length) {
      const r = todo[next];
      // Stop scheduling before the cap could be crossed (in-run check).
      if (rawSpend + spent + estOne(r) > cfg.cost_cap_usd) { console.log('STOPPED at cost cap'); return; }
      next++;
      const b = build(r);
      let parsed: any = null, err: string | null = null, res: any = null, cost = 0;
      for (let attempt = 1; attempt <= 3 && !parsed; attempt++) {
        res = await callOpenRouter({
          model: judge,
          messages: [{ role: 'system', content: b.system }, { role: 'user', content: b.user }],
          maxTokens: 2000, reasoningEffort: cfg.models.reasoning_effort, allowFallbacks: false
        });
        cost += res.usage.cost_usd ?? 0;
        if (!res.ok) { err = res.error; break; }
        try {
          const j = parseJson(res.text ?? '');
          err = validate(task, j, b.terms);
          if (!err) parsed = j;
        } catch (e) { err = `parse: ${(e as Error).message}`; }
      }
      spent += cost;
      appendFileSync(out, JSON.stringify({
        key: responseKey(r), task, run_id: runId, judge_model: judge.id, provider_reported: res?.provider ?? null,
        prompts_sha256: PROMPTS_SHA256, terms: b.terms, judgment: parsed, raw: parsed ? undefined : res?.text,
        ok: !!parsed, error: parsed ? null : err, judge_cost_usd: cost, usage: res?.usage ?? null
      }) + '\n');
      if (parsed) ok++; else { failed++; console.log(`  FAILED ${responseKey(r)}: ${err}`); }
      // Out of OpenRouter credits: stop instead of failing every remaining job.
      if (!parsed && (err?.startsWith('402') || /^403: .*limit exceeded/i.test(err ?? ''))) {
        console.log(`STOPPED: OpenRouter spending limit reached (${err?.slice(0, 60)}). Add credits or raise the key limit, then re-run to resume.`);
        next = todo.length;
      }
      if ((ok + failed) % 25 === 0 || ok + failed === todo.length) console.log(`  ${ok + failed}/${todo.length} (${ok} ok, ${failed} failed) judge spend $${spent.toFixed(4)}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`finished: ${ok} ok, ${failed} failed; judge spend $${spent.toFixed(4)}; ${out}`);
});
