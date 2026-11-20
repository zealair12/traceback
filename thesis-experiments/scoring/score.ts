// Phase 6, step 1: deterministic scoring of every full-run response.
// Usage: tsx scoring/score.ts   -> results/scored/deterministic.jsonl
//
// Per response:
//  - no_answer: empty text, or still cut off at the output cap
//  - leak_raw: any planted sibling canary / conflicting value appears (string match)
//  - leak_exposed: same, counting only items that were in the built context
//    (config analysis.window_leakage = conditional_on_exposure). Items found but
//    not in the context are chance hits (forced-choice guesses), reported apart.
//  - correct: required value present and no conflicting value asserted
//  - needs_leak_judge: leak_exposed = 1 -> the judge decides used vs mentioned

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/config.js';
import { readJsonl } from '../generator/validate.js';
import { detect } from './leak_detect.js';
import { loadResponses, responseKey } from './merge.js';

const scen = new Map(readJsonl(join(ROOT, 'data/scenarios.jsonl')).map((s) => [s.id, s]));
const rows = loadResponses();
const out: any[] = [];

for (const r of rows) {
  const s = scen.get(r.scenario);
  if (!s) throw new Error(`unknown scenario ${r.scenario}`);
  const text = (r.response ?? '').trim();
  const no_answer = text === '' || r.finish_reason === 'length';
  const d = detect(text, s);
  const inContext = new Set([...r.exposure.canaries, ...r.exposure.leak_values]);
  const found = [...d.canaries_found, ...d.leak_values_found];
  const exposedFound = found.filter((t) => inContext.has(t));
  const chanceFound = found.filter((t) => !inContext.has(t));
  out.push({
    key: responseKey(r),
    model: r.model,
    model_role: r.model_role,
    scenario: r.scenario,
    domain: s.domain,
    condition: r.condition,
    rep: r.rep,
    variables: r.variables,
    rerun: r.rerun ? r.rerun.reason : null,
    no_answer,
    finish_reason: r.finish_reason,
    leak_raw: found.length ? 1 : 0,
    leak_exposed: exposedFound.length ? 1 : 0,
    leaked_items_exposed: exposedFound,
    chance_items: chanceFound,
    canary_leak_raw: d.canary_leak,
    canary_leak_exposed: d.canaries_found.some((c) => inContext.has(c)) ? 1 : 0,
    value_leak_exposed: d.leak_values_found.some((v) => inContext.has(v)) ? 1 : 0,
    correct_value_present: d.correct_value_present,
    correct: no_answer ? 0 : d.correct,
    needs_leak_judge: exposedFound.length > 0 && !no_answer,
    exposure: {
      sibling_messages: r.exposure.sibling_messages.length,
      sibling_branches: r.exposure.sibling_branches.length,
      canaries_in_context: r.exposure.canaries.length,
      values_in_context: r.exposure.leak_values.length,
      any_planted_in_context: inContext.size > 0,
      required_fact_present: r.exposure.required_fact_present
    },
    tokens: {
      reference_context: r.ref_tokens.context,
      budget: r.ref_tokens.budget,
      prompt_usage: r.usage.prompt_tokens,
      completion_usage: r.usage.completion_tokens
    },
    window_ratio: r.window_ratio,
    cost_usd: r.cost_usd
  });
}

mkdirSync(join(ROOT, 'results/scored'), { recursive: true });
const file = join(ROOT, 'results/scored/deterministic.jsonl');
writeFileSync(file, out.map((x) => JSON.stringify(x)).join('\n') + '\n');

// ---- summary ----
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isNaN(x) ? '  n/a' : `${(100 * x).toFixed(1)}%`.padStart(6));
console.log(`scored ${out.length} responses (${(rows as any).replaced} replaced by D1 re-runs) -> ${file}`);
console.log(`no answer: ${out.filter((x) => x.no_answer).length}`);
console.log('\nmodel           condition   n     correct  leak_raw  leak_exposed  chance-only  needs-judge  fact-in-ctx  planted-in-ctx');
for (const role of ['frontier', 'mid', 'open_weights'])
  for (const c of ['ancestor', 'full_tree', 'window']) {
    const xs = out.filter((x) => x.model_role === role && x.condition === c);
    console.log(
      `${role.padEnd(15)} ${c.padEnd(10)} ${String(xs.length).padStart(4)}   ${pct(mean(xs.map((x) => x.correct)))}    ${pct(mean(xs.map((x) => x.leak_raw)))}     ${pct(mean(xs.map((x) => x.leak_exposed)))}       ${pct(mean(xs.map((x) => (x.chance_items.length && !x.leak_exposed ? 1 : 0))))}       ${String(xs.filter((x) => x.needs_leak_judge).length).padStart(5)}       ${pct(mean(xs.map((x) => (x.exposure.required_fact_present ? 1 : 0))))}       ${pct(mean(xs.map((x) => (x.exposure.any_planted_in_context ? 1 : 0))))}`
    );
  }
const anc = out.filter((x) => x.condition === 'ancestor');
console.log(`\ndetector calibration on ancestor-only: canary hits ${anc.filter((x) => x.canary_leak_raw).length}/${anc.length}; forced-choice value hits ${anc.filter((x) => x.leak_raw && !x.canary_leak_raw).length}/${anc.length}`);
console.log(`responses needing the leak judge: ${out.filter((x) => x.needs_leak_judge).length}`);
