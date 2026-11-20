// Load the full-run responses with the protocol deviations applied.
// D1 (DEVIATIONS.md): for keys re-run at max_tokens 4096, the re-run line
// replaces the original line. The pilot log is not part of the full run.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/config.js';

export const RUN_FILES = ['frontier.jsonl', 'mid.jsonl', 'open_weights.jsonl'];
export const RERUN_FILES = ['open_weights.rerun-maxtokens4096.jsonl'];

const readLines = (p: string) =>
  existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];

export const responseKey = (r: any) => `${r.model}|${r.scenario}|${r.condition}|${r.rep}`;

export function loadResponses(): any[] {
  const dir = join(ROOT, 'results/raw');
  const byKey = new Map<string, any>();
  for (const f of RUN_FILES) for (const r of readLines(join(dir, f))) if (r.ok) byKey.set(responseKey(r), r);
  let replaced = 0;
  for (const f of RERUN_FILES)
    for (const r of readLines(join(dir, f))) {
      if (!r.ok) continue;
      const k = responseKey(r);
      if (!byKey.has(k)) throw new Error(`re-run ${k} has no original`);
      byKey.set(k, r);
      replaced++;
    }
  const rows = [...byKey.values()];
  (rows as any).replaced = replaced;
  return rows;
}
