// Scenario validator. Run on every scenario before freezing; any error fails.
// Usage: tsx generator/validate.ts [file.jsonl ...]   (default: data/sample.jsonl)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ROOT, type ExperimentConfig } from '../lib/config.js';
import { countTokens } from '../builders/tokens.js';
import { containsTerm, countTerm } from '../lib/match.js';
import { DOMAINS } from './content/domains.js';
import { forkExchange } from './build.js';
import type { Scenario, ScenarioMessage } from '../lib/types.js';

export function validateScenario(s: Scenario, cfg: ExperimentConfig): string[] {
  const errs: string[] = [];
  const err = (m: string) => errs.push(`${s.id}: ${m}`);
  const byId = new Map<string, ScenarioMessage>();
  for (const m of s.messages) {
    if (byId.has(m.id)) err(`duplicate message id ${m.id}`);
    byId.set(m.id, m);
  }
  const v = s.variables;

  // ---- structure ----
  const roots = s.messages.filter((m) => m.parent === null);
  if (roots.length !== 1) err(`expected 1 root, found ${roots.length}`);
  for (const m of s.messages) {
    if (m.parent === null) { if (m.role !== 'user') err(`root ${m.id} must be a user message`); continue; }
    const p = byId.get(m.parent);
    if (!p) { err(`${m.id} has missing parent ${m.parent}`); continue; }
    if (p.role === m.role) err(`${m.id} has the same role as its parent`);
    if (!(m.t > p.t)) err(`${m.id} t=${m.t} is not after its parent t=${p.t}`);
  }
  const ts = s.messages.map((m) => m.t);
  if (new Set(ts).size !== ts.length) err('logical timestamps are not unique');
  if (!ts.every((t) => Number.isInteger(t) && t >= 0)) err('timestamps must be non-negative integers');
  if (!(s.ask_t > Math.max(...ts))) err('ask_t must be after every message');

  // Active path = ancestors of ask_node, and exactly the messages labelled "active".
  const ask = byId.get(s.ask_node);
  if (!ask) { err('ask_node missing'); return errs; }
  if (ask.role !== 'assistant') err('ask_node must be an assistant message');
  const chain: ScenarioMessage[] = [];
  for (let cur: ScenarioMessage | undefined = ask; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) chain.unshift(cur);
  const activeSet = new Set(chain.map((m) => m.id));
  const labelledActive = s.messages.filter((m) => m.branch === 'active').map((m) => m.id);
  if (labelledActive.length !== activeSet.size || !labelledActive.every((id) => activeSet.has(id)))
    err('messages labelled "active" are not exactly the root-to-ask_node path');
  if (chain.length !== 2 * v.depth) err(`active path has ${chain.length} messages, expected ${2 * v.depth}`);
  const exchangeOf = (id: string) => Math.floor(chain.findIndex((m) => m.id === id) / 2) + 1;

  // Siblings: k branches, each a chain of 2*sibling_exchanges hanging off fork_node.
  const f = forkExchange(v.depth);
  if (exchangeOf(s.fork_node) !== f || byId.get(s.fork_node)?.role !== 'assistant')
    err(`fork_node must be the assistant message of active exchange ${f}`);
  const branches = [...new Set(s.messages.map((m) => m.branch).filter((b) => b !== 'active'))];
  if (branches.length !== v.siblings) err(`found ${branches.length} sibling branches, expected ${v.siblings}`);
  for (const b of branches) {
    const ms = s.messages.filter((m) => m.branch === b).sort((a, z) => a.t - z.t);
    if (ms.length !== 2 * cfg.design.sibling_exchanges) err(`branch ${b} has ${ms.length} messages`);
    if (ms[0]?.parent !== s.fork_node) err(`branch ${b} does not start at fork_node`);
    for (let i = 1; i < ms.length; i++) if (ms[i].parent !== ms[i - 1].id) err(`branch ${b} is not a single chain`);
  }
  if (s.planted.length !== v.siblings || !s.planted.every((p) => p.type === v.type))
    err('planted entries do not match sibling count/type');

  // ---- timestamps match recency ----
  const sibMsgs = s.messages.filter((m) => m.branch !== 'active');
  const forkT = byId.get(s.fork_node)!.t;
  if (v.recency === 'early') {
    const next = chain[2 * f]; // user message of active exchange f+1
    if (!next) err('early recency needs an active exchange after the fork');
    else if (!sibMsgs.every((m) => m.t > forkT && m.t < next.t))
      err('early: sibling messages must fall between the fork and the next active turn');
  } else if (!sibMsgs.every((m) => m.t > ask.t)) {
    err('late: sibling messages must come after the last active turn');
  }

  // ---- canaries: exactly once, only in their own branch ----
  const allText = [...s.messages.map((m) => m.text), s.question];
  for (const p of s.planted) {
    for (const c of p.canaries) {
      const total = allText.reduce((n, t) => n + countTerm(t, c), 0);
      if (total !== 1) err(`canary ${c} appears ${total} times (expected exactly 1)`);
      const holders = s.messages.filter((m) => containsTerm(m.text, c));
      if (holders.some((m) => m.branch !== p.branch)) err(`canary ${c} appears outside branch ${p.branch}`);
    }
    if (p.type === 'conflicting' && !p.value) err(`conflicting branch ${p.branch} has no value`);
    if (p.value && !s.messages.some((m) => m.branch === p.branch && containsTerm(m.text, p.value!)))
      err(`conflicting value ${p.value} not present in its branch ${p.branch}`);
  }

  // ---- answer key ----
  const expectedLeak = new Set([...s.planted.map((p) => p.value).filter(Boolean), ...s.planted.flatMap((p) => p.canaries)]);
  if (expectedLeak.size !== s.answer_key.leak.length || !s.answer_key.leak.every((x) => expectedLeak.has(x)))
    err('answer_key.leak does not equal planted values + canaries');
  for (const c of s.answer_key.correct)
    for (const l of s.answer_key.leak)
      if (containsTerm(c, l) || containsTerm(l, c)) err(`correct "${c}" and leak "${l}" overlap`);

  // ---- no sibling value anywhere on the active path or in the question ----
  for (const l of s.answer_key.leak) {
    for (const m of chain) if (containsTerm(m.text, l)) err(`sibling value "${l}" appears on the active path (${m.id})`);
    if (containsTerm(s.question, l)) err(`sibling value "${l}" appears in the question`);
  }

  // ---- required fact: answerable from active path, at the stated position ----
  const rf = s.required_fact;
  const rfMsg = byId.get(rf.message);
  const factEx = v.fact_position === 'root' ? 1 : v.depth;
  if (!rfMsg || !activeSet.has(rf.message)) err('required_fact.message is not on the active path');
  else {
    if (!containsTerm(rfMsg.text, rf.value)) err('required_fact.message does not contain the value');
    if (exchangeOf(rf.message) !== factEx) err(`required fact is in exchange ${exchangeOf(rf.message)}, expected ${factEx}`);
  }
  for (const m of chain)
    if (containsTerm(m.text, rf.value) && exchangeOf(m.id) !== factEx)
      err(`correct value also appears on the active path outside the fact exchange (${m.id})`);
  if (!s.answer_key.correct.includes(rf.value)) err('answer_key.correct does not include required_fact.value');
  const domain = DOMAINS.find((d) => d.id === s.domain);
  if (!domain) err(`unknown domain ${s.domain}`);
  else for (const o of domain.options) if (containsTerm(s.question, o)) err(`question leaks option "${o}"`);

  // ---- message lengths ----
  for (const m of s.messages) {
    const n = countTokens(m.text, cfg.tokens.reference_encoding);
    const [lo, hi] = cfg.tokens.band[m.role];
    if (n < lo || n > hi) err(`${m.id} (${m.role}) has ${n} tokens, outside [${lo}, ${hi}]`);
  }
  return errs;
}

export function readJsonl(path: string): Scenario[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const files = process.argv.slice(2);
  const paths = files.length ? files : [join(ROOT, 'data/sample.jsonl')];
  let bad = 0;
  let total = 0;
  for (const p of paths) {
    for (const s of readJsonl(p)) {
      total++;
      const errs = validateScenario(s, cfg);
      if (errs.length) { bad++; errs.forEach((e) => console.error('FAIL ' + e)); }
    }
  }
  console.log(`${total - bad}/${total} scenarios valid`);
  if (bad) process.exit(1);
}
