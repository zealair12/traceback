// Safety-guard tests. Uses made-up passwords; never connects to anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeDatabase, endpointId, UnsafeDatabaseError } from '../lib/env.js';

const EXP = 'ep-example-exp-111111.c-1.us-east-1.aws.neon.tech';
const PROD = 'ep-example-prod-222222.c-2.us-east-1.aws.neon.tech';
const url = (host: string) => `postgresql://u:fake@${host}/db?sslmode=require`;
const base = { EXPERIMENT_DB_HOST: EXP, PROD_DB_HOST_DENYLIST: PROD };

test('experiment URL passes', () => {
  assert.equal(assertSafeDatabase({ ...base, DATABASE_URL: url(EXP) }), EXP);
});

test('production URL is refused', () => {
  assert.throws(() => assertSafeDatabase({ ...base, DATABASE_URL: url(PROD) }), /deny-listed production host/);
});

test('production pooled URL is refused', () => {
  const pooled = PROD.replace('ep-example-prod-222222', 'ep-example-prod-222222-pooler');
  assert.throws(() => assertSafeDatabase({ ...base, DATABASE_URL: url(pooled) }), /deny-listed production host/);
});

test('production URL is refused even if EXPERIMENT_DB_HOST is set to it', () => {
  assert.throws(
    () => assertSafeDatabase({ EXPERIMENT_DB_HOST: PROD, PROD_DB_HOST_DENYLIST: PROD, DATABASE_URL: url(PROD) }),
    UnsafeDatabaseError
  );
});

test('host not matching EXPERIMENT_DB_HOST is refused', () => {
  assert.throws(() => assertSafeDatabase({ ...base, DATABASE_URL: url('localhost') }), /does not match/);
});

test('empty deny list is refused', () => {
  assert.throws(() => assertSafeDatabase({ EXPERIMENT_DB_HOST: EXP, PROD_DB_HOST_DENYLIST: '', DATABASE_URL: url(EXP) }), /DENYLIST is empty/);
});

test('missing or malformed URL is refused', () => {
  assert.throws(() => assertSafeDatabase({ ...base }), /missing/);
  assert.throws(() => assertSafeDatabase({ ...base, DATABASE_URL: 'not a url' }), /not a valid URL/);
  assert.throws(() => assertSafeDatabase({ ...base, DATABASE_URL: `mysql://u:p@${EXP}/db` }), /not a postgres URL/);
});

test('refusal messages never contain the password', () => {
  try { assertSafeDatabase({ ...base, DATABASE_URL: `postgresql://u:SECRETPW@${PROD}/db` }); }
  catch (e) { assert.ok(!String((e as Error).message).includes('SECRETPW')); return; }
  assert.fail('expected refusal');
});

test('endpointId strips region and pooler suffix', () => {
  assert.equal(endpointId('ep-a-b-pooler.c-1.us-east-1.aws.neon.tech'), 'ep-a-b');
});
