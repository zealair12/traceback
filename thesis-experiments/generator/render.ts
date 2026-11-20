// Render scenarios as readable text for spot checks.
// Usage: tsx generator/render.ts [--file data/sample.jsonl] [id ...]   (no ids: first 3)

import { join } from 'node:path';
import { ROOT } from '../lib/config.js';
import { readJsonl } from './validate.js';
import type { Scenario } from '../lib/types.js';

export function render(s: Scenario): string {
  const v = s.variables;
  const lines: string[] = [];
  lines.push('='.repeat(100));
  lines.push(`${s.id}`);
  lines.push(`domain=${s.domain} depth=${v.depth} siblings=${v.siblings} type=${v.type} recency=${v.recency} fact=${v.fact_position}`);
  lines.push(`fork=${s.fork_node} ask_node=${s.ask_node} ask_t=${s.ask_t} required=${s.required_fact.value} (in ${s.required_fact.message})`);
  lines.push('-'.repeat(100));
  for (const m of [...s.messages].sort((a, b) => a.t - b.t)) {
    const tag = m.branch === 'active' ? 'ACTIVE' : `  ${m.branch.toUpperCase()}  `;
    lines.push(`t=${String(m.t).padStart(2)} [${tag}] ${m.id} <- ${m.parent ?? 'root'}  ${m.role.toUpperCase()}: ${m.text}`);
  }
  lines.push(`t=${String(s.ask_t).padStart(2)} [QUESTION] (child of ${s.ask_node}) USER: ${s.question}`);
  lines.push('-'.repeat(100));
  for (const p of s.planted)
    lines.push(`planted ${p.branch}: type=${p.type}${p.value ? ` value=${p.value}` : ''}${p.topic ? ` topic=${p.topic}` : ''} canaries=${p.canaries.join(', ')}`);
  lines.push(`answer_key: correct=${JSON.stringify(s.answer_key.correct)} leak=${JSON.stringify(s.answer_key.leak)}`);
  return lines.join('\n');
}

const args = process.argv.slice(2);
const fi = args.indexOf('--file');
const file = fi >= 0 ? args[fi + 1] : join(ROOT, 'data/sample.jsonl');
const ids = args.filter((_a, i) => fi < 0 || (i !== fi && i !== fi + 1));
const all = readJsonl(file);
const chosen = ids.length ? all.filter((s) => ids.includes(s.id)) : all.slice(0, 3);
console.log(chosen.map(render).join('\n\n'));
