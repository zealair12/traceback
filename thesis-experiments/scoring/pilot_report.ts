// Pilot acceptance report for one raw log: detection, false-positive rate on
// ancestor-only, window ratios, cost vs estimate, and a projection for the full run.
// Usage: tsx scoring/pilot_report.ts --log results/raw/pilot-mistral.jsonl
//        [--file data/sample.jsonl] [--full <all scenarios jsonl>] [--calls-per-model 2592]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../lib/config.js';
import { readJsonl } from '../generator/validate.js';
import { countTokens } from '../builders/tokens.js';
import { detect } from './leak_detect.js';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const log = flag('--log') ?? join(ROOT, 'results/raw/pilot-mistral.jsonl');
const cfg: any = loadConfig();
const scen = new Map(readJsonl(flag('--file') ?? join(ROOT, 'data/sample.jsonl')).map((s) => [s.id, s]));
const rows = readFileSync(log, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => r.ok);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : `${(100 * x).toFixed(1)}%`);
const conds = ['ancestor', 'full_tree', 'window'];

const scored = rows.map((r) => ({ r, d: detect(r.response ?? '', scen.get(r.scenario)!) }));

console.log(`log: ${log}  (${rows.length} successful calls)`);
console.log(`providers reported: ${[...new Set(rows.map((r) => r.provider_reported))].join(', ')} | finish reasons: ${JSON.stringify(rows.reduce((m: any, r) => ((m[r.finish_reason] = (m[r.finish_reason] ?? 0) + 1), m), {}))}`);

console.log('\n1. detection by condition');
console.log('   condition   n   any-leak  canary-leak  conflict-value-leak  correct  ambiguous  fact-in-context  canary-exposed(calls)');
for (const c of conds) {
  const xs = scored.filter((x) => x.r.condition === c);
  const conflictRows = xs.filter((x) => x.r.variables.type === 'conflicting');
  console.log(`   ${c.padEnd(10)} ${String(xs.length).padStart(2)}   ${pct(mean(xs.map((x) => x.d.leak))).padStart(7)}   ${pct(mean(xs.map((x) => x.d.canary_leak))).padStart(9)}   ${pct(mean(conflictRows.map((x) => (x.d.leak_values_found.length ? 1 : 0)))).padStart(17)} (n=${conflictRows.length})  ${pct(mean(xs.map((x) => x.d.correct))).padStart(6)}  ${String(xs.filter((x) => x.d.ambiguous).length).padStart(9)}  ${pct(mean(xs.map((x) => (x.r.exposure.required_fact_present ? 1 : 0)))).padStart(15)}  ${pct(mean(xs.map((x) => (x.r.exposure.canaries.length ? 1 : 0)))).padStart(12)}`);
}

console.log('\n2. detector calibration on ancestor-only (sibling facts are absent by construction)');
const anc = scored.filter((x) => x.r.condition === 'ancestor');
const fp = anc.filter((x) => x.d.canary_leak);
console.log(`   canary false-positive rate: ${fp.length}/${anc.length} = ${pct(fp.length / anc.length)}`);
const ancConf = anc.filter((x) => x.r.variables.type === 'conflicting');
console.log(`   conflicting-value baseline (forced choice): ${ancConf.filter((x) => x.d.leak_values_found.length).length}/${ancConf.length}`);
for (const x of fp) console.log(`   FP: ${x.r.scenario} found ${x.d.canaries_found.join(', ')}`);

console.log('\n3. leaks observed (non-ancestor), with whether the leaked item was in the context');
for (const x of scored.filter((x) => x.r.condition !== 'ancestor' && x.d.leak)) {
  const inCtx = [...x.d.canaries_found, ...x.d.leak_values_found].map((t) => `${t}${(x.r.exposure.canaries.includes(t) || x.r.exposure.leak_values.includes(t)) ? '' : ' (NOT in context!)'}`);
  console.log(`   ${x.r.condition.padEnd(9)} ${x.r.scenario}: ${inCtx.join(', ')}${x.d.correct_value_present ? ' | also stated correct value' : ''}`);
}

console.log('\n4. window-to-budget ratio (window calls)');
const wr = rows.filter((r) => r.condition === 'window').map((r) => r.window_ratio);
console.log(`   min ${Math.min(...wr).toFixed(3)}  mean ${mean(wr).toFixed(3)}  max ${Math.max(...wr).toFixed(3)} | windows starting with assistant: ${rows.filter((r) => r.condition === 'window' && r.starts_with_assistant).length} (all accepted)`);

console.log('\n5. tokens and cost');
const tokRatio = mean(rows.map((r) => r.usage.prompt_tokens / (r.ref_tokens.system + r.ref_tokens.context + r.ref_tokens.question)));
console.log(`   provider prompt tokens / reference tokens: ${tokRatio.toFixed(3)}`);
for (const c of conds) {
  const xs = rows.filter((r) => r.condition === c);
  console.log(`   ${c.padEnd(10)} prompt ${mean(xs.map((r) => r.usage.prompt_tokens)).toFixed(0)}  completion ${mean(xs.map((r) => r.usage.completion_tokens)).toFixed(0)} (reasoning ${mean(xs.map((r) => r.usage.reasoning_tokens ?? 0)).toFixed(0)})  cost/call $${mean(xs.map((r) => r.cost_usd)).toFixed(5)}`);
}
const actual = mean(rows.map((r) => r.cost_usd));
const est = mean(rows.map((r) => r.est_cost_usd));
console.log(`   mean cost per call: actual $${actual.toFixed(5)} vs estimate $${est.toFixed(5)} (actual/estimate ${(actual / est).toFixed(2)}); total $${rows.reduce((a, r) => a + r.cost_usd, 0).toFixed(4)}`);
console.log(`   cost source: ${JSON.stringify(rows.reduce((m: any, r) => ((m[r.cost_source] = (m[r.cost_source] ?? 0) + 1), m), {}))}`);

// ---- projection ----
const fullFile = flag('--full');
if (fullFile && existsSync(fullFile)) {
  const all = readJsonl(fullFile);
  const callsPerModel = Number(flag('--calls-per-model') ?? 2592);
  const sys = rows[0].ref_tokens.system;
  let anc = 0, full = 0, q = 0;
  for (const s of all) {
    const by = new Map(s.messages.map((m) => [m.id, m]));
    for (let cur: any = by.get(s.ask_node); cur; cur = cur.parent ? by.get(cur.parent) : null) anc += countTokens(cur.text);
    full += s.messages.reduce((a, m) => a + countTokens(m.text), 0);
    q += countTokens(s.question);
  }
  const n = all.length;
  const winRatio = mean(wr);
  const refIn = (sys + q / n) + (anc / n + full / n + (anc / n) * winRatio) / 3;
  const outTok = mean(rows.map((r) => r.usage.completion_tokens));
  console.log(`\n6. full-run projection (${n} scenarios, ${callsPerModel} calls per model incl. repeats)`);
  console.log(`   mean reference input/call ${refIn.toFixed(0)} tokens; output assumed ${outTok.toFixed(0)} tokens/call (Mistral pilot incl. reasoning)`);
  let total = 0;
  for (const spec of cfg.models.under_test) {
    const c = callsPerModel * ((refIn * tokRatio * spec.price.in + outTok * spec.price.out) / 1e6);
    total += c;
    console.log(`   ${spec.id.padEnd(30)} $${c.toFixed(2)}`);
  }
  const j = cfg.models.judge;
  const judgeIn = anc / n + q / n + outTok + 400; // active path + question + answer + rubric
  const judgeCalls = callsPerModel * cfg.models.under_test.length;
  const jc = judgeCalls * ((judgeIn * spec0Ratio() * j.price.in + 300 * j.price.out) / 1e6);
  function spec0Ratio() { return tokRatio; }
  total += jc;
  console.log(`   judge ${j.id} (${judgeCalls} judgments, ~${judgeIn.toFixed(0)} in / 300 out) $${jc.toFixed(2)}`);
  console.log(`   TOTAL projected $${total.toFixed(2)} vs cap $${cfg.cost_cap_usd}`);
}
