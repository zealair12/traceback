// Deterministic scenario builder. Every planted fact, the tree shape and the
// logical timestamps are fixed by (config seed, cell variables, instance).
// Only template text is used here; an optional cached LLM paraphrase pass can
// later rewrite filler around the planted facts without moving them.

import { DOMAINS, type Domain, type Exchange } from './content/domains.js';
import {
  IRRELEVANT_TOPICS, USER_PADS, ASSISTANT_PADS, OFFTOPIC_USER_PADS, OFFTOPIC_ASSISTANT_PADS
} from './content/irrelevant.js';
import { Rng, hashString } from '../lib/rng.js';
import { countTokens } from '../builders/tokens.js';
import type { ExperimentConfig } from '../lib/config.js';
import type { Variables, Scenario, ScenarioMessage, Planted } from '../lib/types.js';

export function cellKey(v: Variables): string {
  return `d${v.depth}-k${v.siblings}-${v.type}-${v.recency}-${v.fact_position}`;
}

// All design cells in a fixed order. The index of a cell in this list is stable,
// so a sample scenario is byte-identical to the same scenario in the full set.
export function enumerateCells(cfg: ExperimentConfig): Variables[] {
  const out: Variables[] = [];
  const d = cfg.design;
  for (const depth of d.depths)
    for (const siblings of d.sibling_counts)
      for (const type of d.types)
        for (const recency of d.recency)
          for (const fact_position of d.fact_position)
            out.push({ depth, siblings, type, recency, fact_position });
  return out;
}

export function forkExchange(depth: number): number {
  return Math.max(1, Math.floor(depth / 2));
}

// ---------- canaries ----------
const IDENT_PREFIXES = ['vx', 'kq', 'zr', 'tbl', 'cfg', 'orbit', 'quill', 'lume', 'pax', 'grid', 'nimb', 'tarn'];
const COMMON_PORTS = new Set([2049, 3000, 3306, 4000, 4200, 5000, 5173, 5432, 5672, 6379, 8000, 8080, 8443, 8888, 9000, 9090, 9092, 9200]);

class CanaryFactory {
  private used = new Set<string>();
  constructor(private rng: Rng) {}
  make(kind: string): string {
    for (let tries = 0; tries < 1000; tries++) {
      const c = this.raw(kind);
      if (!this.used.has(c.toLowerCase())) { this.used.add(c.toLowerCase()); return c; }
    }
    throw new Error(`could not make unique canary of kind ${kind}`);
  }
  private raw(kind: string): string {
    const r = this.rng;
    switch (kind) {
      case 'ident': {
        const chars = 'abcdefghjkmnpqrstuvwxyz';
        const digits = '23456789';
        const tail = [r.pick([...chars]), r.pick([...digits]), r.pick([...chars + digits])];
        return `${r.pick(IDENT_PREFIXES)}_${r.shuffle(tail).join('')}`;
      }
      case 'port': {
        let p: number;
        do { p = r.int(2001, 9899); } while (p % 100 === 0 || COMMON_PORTS.has(p));
        return String(p);
      }
      case 'hex': {
        const hex = '0123456789ABCDEF';
        let h: string;
        do { h = Array.from({ length: 6 }, () => r.pick([...hex])).join(''); }
        while (!/[A-F]/.test(h) || !/[0-9]/.test(h));
        return `#${h}`;
      }
      case 'ver':
        return `${r.int(3, 19)}.${r.int(1, 39)}.${r.int(1, 49)}`;
      default:
        throw new Error(`unknown canary kind ${kind}`);
    }
  }
}

function fill(
  tpl: Exchange,
  vars: { value: string; alt?: string },
  canaries: CanaryFactory
): { ex: Exchange; canaries: string[] } {
  const made: string[] = [];
  const sub = (s: string) =>
    s
      .replaceAll('{value}', vars.value)
      .replaceAll('{alt}', vars.alt ?? '{alt}')
      .replace(/\{c:(\w+)\}/g, (_m, kind) => {
        const c = canaries.make(kind);
        made.push(c);
        return c;
      });
  const ex = { user: sub(tpl.user), assistant: sub(tpl.assistant) };
  if (ex.user.includes('{alt}') || ex.assistant.includes('{alt}')) throw new Error('unfilled {alt}');
  return { ex, canaries: made };
}

function pad(text: string, role: 'user' | 'assistant', rng: Rng, cfg: ExperimentConfig, offTopic: boolean): string {
  const [lo, hi] = cfg.tokens.target[role];
  const target = rng.int(lo, hi);
  const pool = rng.shuffle(
    offTopic
      ? (role === 'user' ? OFFTOPIC_USER_PADS : OFFTOPIC_ASSISTANT_PADS)
      : (role === 'user' ? USER_PADS : ASSISTANT_PADS)
  );
  let out = text;
  while (countTokens(out, cfg.tokens.reference_encoding) < target && pool.length) {
    out += ' ' + pool.pop();
  }
  return out;
}

// Hands out neutral Q/A exchanges: unused ones first, then reuse across
// branches, but never the same exchange twice inside one branch.
class QaDealer {
  private order: number[];
  private cursor = 0;
  constructor(private domain: Domain, private rng: Rng) {
    this.order = rng.shuffle(domain.qa.map((_, i) => i));
  }
  take(usedInBranch: Set<number>): Exchange {
    for (let n = 0; n < this.domain.qa.length * 2; n++) {
      if (this.cursor >= this.order.length) {
        this.order = this.rng.shuffle(this.domain.qa.map((_, i) => i));
        this.cursor = 0;
      }
      const i = this.order[this.cursor++];
      if (!usedInBranch.has(i)) { usedInBranch.add(i); return this.domain.qa[i]; }
    }
    throw new Error(`domain ${this.domain.id}: not enough Q/A exchanges for one branch`);
  }
}

export function buildScenario(v: Variables, cellIndex: number, instance: number, cfg: ExperimentConfig): Scenario {
  const domain = DOMAINS[(cellIndex + instance) % DOMAINS.length];
  const seed = hashString(`${cfg.seed}|${cellKey(v)}|${instance}`);
  const rng = new Rng(seed);
  const canaries = new CanaryFactory(rng);
  const qa = new QaDealer(domain, rng);
  const sibEx = cfg.design.sibling_exchanges;

  const options = rng.shuffle(domain.options);
  const correct = options[0];
  const alts = options.slice(1, 1 + v.siblings);
  if (v.type === 'conflicting' && alts.length < v.siblings) throw new Error('not enough alternative options');

  // ---- active path content ----
  const factEx = v.fact_position === 'root' ? 1 : v.depth;
  const activeUsed = new Set<number>();
  const active: Exchange[] = [];
  for (let i = 1; i <= v.depth; i++) {
    let ex = i === factEx ? fill(domain.fact, { value: correct }, canaries).ex : qa.take(activeUsed);
    if (i === 1) ex = { ...ex, user: `${domain.intro} ${ex.user}` };
    active.push(ex);
  }

  // ---- sibling content ----
  const topics = rng.shuffle(IRRELEVANT_TOPICS);
  const planted: Planted[] = [];
  const siblings: Exchange[][] = [];
  for (let j = 1; j <= v.siblings; j++) {
    const branch = `s${j}`;
    const exs: Exchange[] = [];
    let made: string[] = [];
    let value: string | null = null;
    let topic: string | undefined;
    if (v.type === 'irrelevant') {
      const tp = topics[j - 1];
      topic = tp.id;
      const f = fill(tp.opener, { value: correct }, canaries);
      exs.push(f.ex);
      made = f.canaries;
      exs.push(...tp.followups.slice(0, sibEx - 1));
    } else {
      const variants = domain[v.type];
      const tpl = variants[(j - 1) % variants.length];
      value = v.type === 'conflicting' ? alts[j - 1] : null;
      const f = fill(tpl, { value: correct, alt: value ?? undefined }, canaries);
      exs.push(f.ex);
      made = f.canaries;
      const used = new Set<number>();
      for (let n = 1; n < sibEx; n++) exs.push(qa.take(used));
    }
    planted.push({ branch, type: v.type, value, canaries: made, ...(topic ? { topic } : {}) });
    siblings.push(exs);
  }

  // ---- tree + logical clock ----
  const messages: ScenarioMessage[] = [];
  let n = 0;
  const emit = (parent: string | null, role: 'user' | 'assistant', text: string, branch: string): string => {
    const id = `m${n + 1}`;
    const offTopic = branch !== 'active' && v.type === 'irrelevant';
    messages.push({ id, parent, role, text: pad(text, role, rng, cfg, offTopic), t: n, branch });
    n++;
    return id;
  };

  const f = forkExchange(v.depth);
  const activeIds: { user: string; assistant: string }[] = [];
  let tip: string | null = null;
  const emitActive = (from: number, to: number) => {
    for (let i = from; i <= to; i++) {
      const u = emit(tip, 'user', active[i - 1].user, 'active');
      const a = emit(u, 'assistant', active[i - 1].assistant, 'active');
      activeIds.push({ user: u, assistant: a });
      tip = a;
    }
  };
  const emitSiblings = (forkId: string) => {
    siblings.forEach((exs, idx) => {
      let p: string = forkId;
      for (const ex of exs) {
        const u = emit(p, 'user', ex.user, `s${idx + 1}`);
        p = emit(u, 'assistant', ex.assistant, `s${idx + 1}`);
      }
    });
  };

  if (v.recency === 'early') {
    emitActive(1, f);
    const forkId = activeIds[f - 1].assistant;
    emitSiblings(forkId);
    emitActive(f + 1, v.depth);
  } else {
    emitActive(1, v.depth);
    emitSiblings(activeIds[f - 1].assistant);
  }

  const id = `${domain.id}-${v.type}-d${v.depth}-k${v.siblings}-${v.recency}-${v.fact_position}-${String(instance).padStart(2, '0')}`;
  const allCanaries = planted.flatMap((p) => p.canaries);
  const leak = [...new Set([...planted.map((p) => p.value).filter((x): x is string => !!x), ...allCanaries])];

  return {
    id,
    domain: domain.id,
    seed,
    variables: v,
    messages,
    fork_node: activeIds[f - 1].assistant,
    ask_node: activeIds[v.depth - 1].assistant,
    ask_t: n,
    question: domain.question,
    required_fact: { value: correct, message: activeIds[factEx - 1].user },
    planted,
    answer_key: { correct: [correct], leak }
  };
}
