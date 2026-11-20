// Build scenarios and write them as JSONL. Fails if any scenario is invalid.
// Usage:
//   tsx generator/build_scenarios.ts --sample 20            -> data/sample.jsonl
//   tsx generator/build_scenarios.ts --all                  -> data/scenarios.jsonl
//   tsx generator/build_scenarios.ts --all --out other.jsonl

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, ROOT } from '../lib/config.js';
import { buildScenario, enumerateCells } from './build.js';
import { validateScenario } from './validate.js';
import type { Scenario } from '../lib/types.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const cfg = loadConfig();
const cells = enumerateCells(cfg);
const scenarios: Scenario[] = [];

if (args.includes('--all')) {
  cells.forEach((v, ci) => {
    for (let inst = 0; inst < cfg.design.instances_per_cell; inst++) scenarios.push(buildScenario(v, ci, inst, cfg));
  });
} else {
  // Balanced sample: cycle through every type x recency x fact_position combo,
  // rotating depth and sibling count, so a small N covers all levels.
  const n = Number(flag('--sample') ?? 20);
  const d = cfg.design;
  const combos = d.types.flatMap((type) => d.recency.flatMap((recency) => d.fact_position.map((fp) => ({ type, recency, fp }))));
  for (let i = 0; i < n; i++) {
    const c = combos[i % combos.length];
    const depth = d.depths[i % d.depths.length];
    const siblings = d.sibling_counts[Math.floor(i / d.depths.length) % d.sibling_counts.length];
    const ci = cells.findIndex(
      (x) => x.depth === depth && x.siblings === siblings && x.type === c.type && x.recency === c.recency && x.fact_position === c.fp
    );
    const inst = Math.floor(i / combos.length) % d.instances_per_cell;
    scenarios.push(buildScenario(cells[ci], ci, inst, cfg));
  }
}

let bad = 0;
for (const s of scenarios) {
  const errs = validateScenario(s, cfg);
  if (errs.length) { bad++; errs.forEach((e) => console.error('FAIL ' + e)); }
}
if (bad) {
  console.error(`${bad}/${scenarios.length} scenarios failed validation; nothing written.`);
  process.exit(1);
}

const out = flag('--out') ?? join(ROOT, args.includes('--all') ? 'data/scenarios.jsonl' : 'data/sample.jsonl');
writeFileSync(out, scenarios.map((s) => JSON.stringify(s)).join('\n') + '\n');
console.log(`wrote ${scenarios.length} scenarios to ${out} (all valid)`);
