// Build the stratified human-review sample (Phase 6).
// Usage: tsx scoring/human_sample.ts [--n 150]
// Writes:
//   results/human/human_sample.md        what you read: conversation, final message, answer
//   results/human/human_scores.csv       what you fill in: one row per sample
//   results/human/human_sample.key.json  sample id -> response key (do NOT open while scoring)
// The sample is blind (no model or condition shown) and evenly stratified over
// model x condition, in a seeded random order. It shows exactly what the judge sees.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../lib/config.js';
import { Rng } from '../lib/rng.js';
import { readJsonl } from '../generator/validate.js';
import { loadResponses, responseKey } from './merge.js';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const n = Number(args[args.indexOf('--n') + 1] || 150) || 150;
const cfg: any = loadConfig();
const rng = new Rng(cfg.seed + 303);
const scen = new Map(readJsonl(join(ROOT, 'data/scenarios.jsonl')).map((s) => [s.id, s]));
const det = new Map(readFileSync(join(ROOT, 'results/scored/deterministic.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((x) => [x.key, x]));

const groups = new Map<string, any[]>();
for (const r of loadResponses()) {
  const d = det.get(responseKey(r));
  if (!d || d.no_answer || r.rep !== 0) continue; // one run per scenario, answered only
  const g = `${r.model_role}|${r.condition}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g)!.push(r);
}
const per = Math.ceil(n / groups.size);
const picked = rng.shuffle([...groups.values()].flatMap((g) => rng.shuffle(g).slice(0, per))).slice(0, n);

const md: string[] = [
  '# Human review sample', '',
  `${picked.length} answers, blind to model and condition. For each one, read the conversation, the final message and the answer,`,
  'then fill in its row in `human_scores.csv`. Use the same 1 to 5 scale as the judge:', '',
  '- **contextual_faithfulness**: consistent with what was decided in the conversation shown; no details presented as agreed that are not in it.',
  '- **instruction_following**: does what the final message asks, in the requested form (states the value, gives the requested line).',
  '- **task_completion**: the developer gets everything they asked for, correct and usable.',
  '- **leak_used** (only where terms are listed): `yes` if the answer adopts any listed term as part of its answer, `no` if it only mentions them as alternatives or to reject them.', '',
  'Do not open `human_sample.key.json` until you have finished.', ''
];
const csv = ['sample_id,contextual_faithfulness,instruction_following,task_completion,leak_used,notes'];
const key: Record<string, string> = {};

picked.forEach((r, i) => {
  const id = `H${String(i + 1).padStart(3, '0')}`;
  key[id] = responseKey(r);
  const s = scen.get(r.scenario)!;
  const by = new Map(s.messages.map((m) => [m.id, m]));
  const path: any[] = [];
  for (let cur: any = by.get(s.ask_node); cur; cur = cur.parent ? by.get(cur.parent) : null) path.unshift(cur);
  const terms: string[] = det.get(responseKey(r)).leaked_items_exposed;
  md.push('---', '', `## ${id}`, '', '### Conversation', '');
  for (const m of path) md.push(`**${m.role === 'user' ? 'Developer' : 'Assistant'}:** ${m.text}`, '');
  md.push('### Final message', '', `**Developer:** ${s.question}`, '', '### Answer to score', '', (r.response ?? '').trim(), '');
  if (terms.length) md.push(`### Terms from a separate discussion (fill leak_used)`, '', terms.map((t) => `\`${t}\``).join(', '), '');
  csv.push(`${id},,,,${terms.length ? '' : 'n/a'},`);
});

const dir = join(ROOT, 'results/human');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'human_sample.md'), md.join('\n'));
writeFileSync(join(dir, 'human_scores.csv'), csv.join('\n') + '\n');
writeFileSync(join(dir, 'human_sample.key.json'), JSON.stringify(key, null, 1));
const strata: Record<string, number> = {};
picked.forEach((r) => { const g = `${r.model_role}|${r.condition}`; strata[g] = (strata[g] ?? 0) + 1; });
console.log(`wrote ${picked.length} samples to ${dir}`);
console.log('per model|condition:', JSON.stringify(strata));
console.log(`with leak terms to label: ${picked.filter((r) => det.get(responseKey(r)).leaked_items_exposed.length).length}`);
