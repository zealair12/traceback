// Phase 3 dry run: build all three contexts for every scenario from the
// experiment database, count tokens, and compute exposure. No model is called.
// Usage: tsx builders/dry_run.ts [--file data/sample.jsonl] [--out results/dryrun/sample.jsonl]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, loadConfig } from '../lib/config.js';
import { guarded } from '../lib/env.js';
import { readJsonl } from '../generator/validate.js';
import { countTokens } from './tokens.js';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = flag('--file') ?? join(ROOT, 'data/sample.jsonl');
const out = flag('--out') ?? join(ROOT, 'results/dryrun/sample.jsonl');

await guarded(async () => {
  const cfg = loadConfig();
  const { prisma } = await import('../../server/src/prismaClient.js');
  const { buildAll } = await import('./context.js');
  try {
    const scenarios = readJsonl(file);
    const records: any[] = [];
    const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
    console.log(
      ['scenario'.padEnd(44), 'anc', 'full', 'win', 'E', 'formula', 'win/B', 'win sib br', 'sib msg', 'canary', 'fact?', 'active'].join('  ')
    );
    for (const s of scenarios) {
      const [anc, full, win] = await buildAll(prisma, s, cfg.tokens.reference_encoding);
      const E = 1 - anc.tokens / full.tokens;
      const siblingTokens = s.messages.filter((m) => m.branch !== 'active').reduce((n, m) => n + countTokens(m.text), 0);
      const formula = siblingTokens / full.tokens;
      const rec = {
        scenario: s.id, variables: s.variables,
        tokens: { ancestor: anc.tokens, full_tree: full.tokens, window: win.tokens, question: anc.question_tokens },
        efficiency: E, efficiency_formula: formula,
        window_ratio: win.ratio_to_budget,
        window_starts_with_assistant: win.starts_with_assistant,
        exposure: { ancestor: anc.exposure, full_tree: full.exposure, window: win.exposure }
      };
      records.push(rec);
      const w = win.exposure;
      console.log([
        s.id.padEnd(44), String(anc.tokens).padStart(4), String(full.tokens).padStart(4), String(win.tokens).padStart(4),
        pct(E).padStart(6), pct(formula).padStart(7), win.ratio_to_budget.toFixed(3).padStart(5),
        `${w.sibling_branches.length}/${s.variables.siblings}`.padStart(10), String(w.sibling_messages.length).padStart(7),
        `${w.canaries.length}/${s.planted.flatMap((p) => p.canaries).length}`.padStart(6),
        (w.required_fact_present ? 'yes' : 'NO').padStart(5), `${w.active_messages}/${w.active_total}`.padStart(6)
      ].join('  '));
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

    // ---- summary + sanity check ----
    const n = records.length;
    const share = (pred: (r: any) => boolean, rs = records) => (rs.length ? rs.filter(pred).length / rs.length : NaN);
    const exposed = (r: any) => r.exposure.window.sibling_messages.length > 0;
    console.log('\nsummary');
    console.log(`  scenarios: ${n}`);
    console.log(`  mean token efficiency E: ${pct(records.reduce((a, r) => a + r.efficiency, 0) / n)}; max |E - formula|: ${Math.max(...records.map((r) => Math.abs(r.efficiency - r.efficiency_formula))).toFixed(6)}`);
    const ratios = records.map((r) => r.window_ratio);
    console.log(`  window/B ratio: min ${Math.min(...ratios).toFixed(3)}, mean ${(ratios.reduce((a, b) => a + b, 0) / n).toFixed(3)}, max ${Math.max(...ratios).toFixed(3)}`);
    console.log(`  window contains sibling content: ${pct(share(exposed))} of scenarios`);
    for (const rec of ['early', 'late'])
      for (const fp of ['root', 'current']) {
        const rs = records.filter((r) => r.variables.recency === rec && r.variables.fact_position === fp);
        console.log(`    ${rec}/${fp}: siblings exposed ${pct(share(exposed, rs))}, required fact kept ${pct(share((r) => r.exposure.window.required_fact_present, rs))}, mean sibling share of window ${pct(rs.reduce((a, r) => a + r.exposure.window.sibling_messages.length / Math.max(1, r.exposure.window.sibling_messages.length + r.exposure.window.active_messages), 0) / rs.length)} (n=${rs.length})`);
      }
    console.log(`  window starts with an assistant message: ${pct(share((r) => r.window_starts_with_assistant))}`);
    const all = share(exposed);
    if (all === 1 || all === 0)
      console.log(`  SANITY WARNING: the window contains siblings in ${all === 1 ? 'every' : 'no'} scenario; recency would not vary exposure.`);
    console.log(`\nwrote ${out}`);
  } finally {
    await prisma.$disconnect();
  }
});
