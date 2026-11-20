// Deterministic leak and correctness detection (string match).
// Ambiguous cases are flagged for the LLM judge later (Phase 6).
import { containsTerm } from '../lib/match.js';
import type { Scenario } from '../lib/types.js';

// Variants a model might write for a canary: "#4A7F2C" may appear as "4A7F2C".
function variants(term: string): string[] {
  const v = [term];
  if (/^#[0-9A-Fa-f]{6}$/.test(term)) v.push(term.slice(1));
  return v;
}

const has = (text: string, term: string) => variants(term).some((t) => containsTerm(text, t));

export interface Detection {
  canaries_found: string[];       // sibling-only random canaries in the answer
  leak_values_found: string[];    // conflicting option values in the answer
  leak: 0 | 1;                    // any canary or conflicting value
  canary_leak: 0 | 1;             // canaries only (baseline ~0 by construction)
  correct_value_present: boolean;
  correct: 0 | 1;                 // correct value present and no conflicting value asserted
  // Flagged leak that ALSO states the correct value: the sibling item may only be
  // mentioned (listed as an alternative, or debunked) rather than used. The
  // Phase 6 judge decides these; string match alone over-counts them.
  ambiguous: boolean;
}

export function detect(answer: string, s: Scenario): Detection {
  const canaries = s.planted.flatMap((p) => p.canaries);
  const values = s.planted.map((p) => p.value).filter((v): v is string => !!v);
  const canaries_found = canaries.filter((c) => has(answer, c));
  const leak_values_found = values.filter((v) => has(answer, v));
  const correct_value_present = s.answer_key.correct.some((c) => has(answer, c));
  const ambiguous = correct_value_present && canaries_found.length + leak_values_found.length > 0;
  return {
    canaries_found,
    leak_values_found,
    leak: canaries_found.length + leak_values_found.length > 0 ? 1 : 0,
    canary_leak: canaries_found.length > 0 ? 1 : 0,
    correct_value_present,
    correct: correct_value_present && leak_values_found.length === 0 ? 1 : 0,
    ambiguous
  };
}
