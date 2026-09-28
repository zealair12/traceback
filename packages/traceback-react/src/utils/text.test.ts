// Run: npm test --workspace @traceback/react  (Node's built-in runner; Node 22.18+ runs .ts directly)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLatex } from './text.ts';

test('two prices on a line are both escaped', () => {
  assert.equal(normalizeLatex('It was $917 in March and $1,025 in May.'), 'It was \\$917 in March and \\$1,025 in May.');
});

test('inline math starting with a digit stays math', () => {
  const s = 'Light travels roughly $3 \\times 10^8$ m/s.';
  assert.equal(normalizeLatex(s), s);
});

test('math without LaTeX commands stays math', () => {
  const s = 'The floor on RTT is $2d/c$.';
  assert.equal(normalizeLatex(s), s);
});

test('"$5 and $10" is currency', () => {
  assert.equal(normalizeLatex('$5 and $10'), '\\$5 and \\$10');
});

test('a lone price is currency', () => {
  assert.equal(normalizeLatex('It costs $5.'), 'It costs \\$5.');
});

test('a price range is currency', () => {
  assert.equal(normalizeLatex('Tickets are $5-$10.'), 'Tickets are \\$5-\\$10.');
});

test('mixed sentence: prices escaped, math kept', () => {
  assert.equal(
    normalizeLatex('It costs $5, light travels $3 \\times 10^8$ m/s, and RTT is at least $2d/c$; $x^2$ too.'),
    'It costs \\$5, light travels $3 \\times 10^8$ m/s, and RTT is at least $2d/c$; $x^2$ too.'
  );
});

test('display math and already-escaped dollars are untouched', () => {
  assert.equal(normalizeLatex('$$2x + 1 = 5$$ and \\$20'), '$$2x + 1 = 5$$ and \\$20');
});

test('\\( \\) still converts to $', () => {
  assert.equal(normalizeLatex('\\(x^2\\) costs $5'), '$x^2$ costs \\$5');
});
