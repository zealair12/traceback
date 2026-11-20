// Validator acceptance tests: generated scenarios pass, and deliberate
// corruptions are caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.js';
import { buildScenario, enumerateCells } from '../generator/build.js';
import { validateScenario } from '../generator/validate.js';
import type { Scenario } from '../lib/types.js';

const cfg = loadConfig();
const cells = enumerateCells(cfg);
const clone = (s: Scenario): Scenario => JSON.parse(JSON.stringify(s));
const find = (pred: (s: Scenario) => boolean): Scenario => {
  for (let ci = 0; ci < cells.length; ci++) {
    const s = buildScenario(cells[ci], ci, 0, cfg);
    if (pred(s)) return s;
  }
  throw new Error('no scenario matches');
};

test('every cell (instance 0) builds a valid scenario', () => {
  const failures = cells.flatMap((v, ci) => validateScenario(buildScenario(v, ci, 0, cfg), cfg));
  assert.deepEqual(failures, []);
});

test('generation is deterministic', () => {
  const a = buildScenario(cells[17], 17, 2, cfg);
  const b = buildScenario(cells[17], 17, 2, cfg);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('canary duplicated into the active path is caught', () => {
  const s = clone(find((x) => x.variables.type === 'irrelevant'));
  const canary = s.planted[0].canaries[0];
  const activeMsg = s.messages.find((m) => m.branch === 'active' && m.role === 'assistant')!;
  activeMsg.text += ` Also note ${canary}.`;
  const errs = validateScenario(s, cfg);
  assert.ok(errs.some((e) => e.includes(`canary ${canary} appears 2 times`)), errs.join('\n'));
  assert.ok(errs.some((e) => e.includes(`"${canary}" appears on the active path`)), errs.join('\n'));
});

test('conflicting value copied onto the active path is caught', () => {
  const s = clone(find((x) => x.variables.type === 'conflicting'));
  const alt = s.planted[0].value!;
  s.messages.find((m) => m.branch === 'active')!.text += ` Maybe ${alt}?`;
  assert.ok(validateScenario(s, cfg).some((e) => e.includes(`"${alt}" appears on the active path`)));
});

test('late sibling with an early timestamp is caught', () => {
  const s = clone(find((x) => x.variables.recency === 'late'));
  const sib = s.messages.filter((m) => m.branch === 's1').sort((a, b) => a.t - b.t);
  const fork = s.messages.find((m) => m.id === s.fork_node)!;
  // Move the whole branch to just after the fork while keeping t unique.
  const free = [...Array(1000).keys()].map((i) => fork.t + 0.001 * (i + 1));
  sib.forEach((m, i) => (m.t = free[i]));
  assert.ok(validateScenario(s, cfg).some((e) => e.includes('late: sibling messages')));
});

test('required fact moved to the wrong position is caught', () => {
  const s = clone(find((x) => x.variables.fact_position === 'root' && x.variables.depth === 4));
  const chainUsers = s.messages.filter((m) => m.branch === 'active' && m.role === 'user').sort((a, b) => a.t - b.t);
  s.required_fact.message = chainUsers[2].id;
  assert.ok(validateScenario(s, cfg).some((e) => e.includes('required fact is in exchange') || e.includes('does not contain the value')));
});

test('message far outside the length band is caught', () => {
  const s = clone(find(() => true));
  s.messages[1].text = 'ok';
  assert.ok(validateScenario(s, cfg).some((e) => e.includes('outside [')));
});
