// Experiment environment + database safety guard.
//
// Every script that touches a database calls loadExperimentEnv() FIRST and only
// then dynamically imports anything that creates a Prisma client. (Static ESM
// imports run before any code, and the app's prismaClient.ts creates its client
// at import time with whatever DATABASE_URL is set, so the guard must run first.)
//
// Rules:
//  - Values come ONLY from .env.experiment (or --env-file). A DATABASE_URL already
//    in the shell is ignored and overwritten.
//  - The host in DATABASE_URL must equal EXPERIMENT_DB_HOST.
//  - The deny list must be non-empty, and the DATABASE_URL endpoint must not match
//    any deny-listed endpoint. Neon endpoints are compared by their "ep-..." id,
//    so the pooled form ("ep-x-pooler....") of a production host is also refused.
//  - Secrets are never printed.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

export class UnsafeDatabaseError extends Error {}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

// "ep-example-abc.c-15.us-east-1.aws.neon.tech" -> "ep-example-abc"
// "ep-example-abc-pooler.c-15..."             -> "ep-example-abc"
export function endpointId(host: string): string {
  return host.toLowerCase().split('.')[0].replace(/-pooler$/, '');
}

export function hostOf(databaseUrl: string): string {
  let u: URL;
  try { u = new URL(databaseUrl); } catch { throw new UnsafeDatabaseError('DATABASE_URL is not a valid URL'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new UnsafeDatabaseError('DATABASE_URL is not a postgres URL');
  if (!u.hostname) throw new UnsafeDatabaseError('DATABASE_URL has no host');
  return u.hostname.toLowerCase();
}

// Pure check, unit-tested. Returns the (safe) experiment host or throws.
export function assertSafeDatabase(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL;
  if (!url) throw new UnsafeDatabaseError('DATABASE_URL is missing from the experiment env file');
  const host = hostOf(url);
  const expected = (env.EXPERIMENT_DB_HOST ?? '').trim().toLowerCase();
  if (!expected) throw new UnsafeDatabaseError('EXPERIMENT_DB_HOST is missing');
  const deny = (env.PROD_DB_HOST_DENYLIST ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (deny.length === 0) throw new UnsafeDatabaseError('PROD_DB_HOST_DENYLIST is empty; refusing to run without it');
  for (const d of deny) {
    if (host === d || endpointId(host) === endpointId(d))
      throw new UnsafeDatabaseError(`DATABASE_URL points at a deny-listed production host (${endpointId(d)}); refusing`);
  }
  if (host !== expected)
    throw new UnsafeDatabaseError(`DATABASE_URL host (${endpointId(host)}) does not match EXPERIMENT_DB_HOST (${endpointId(expected)})`);
  if (endpointId(expected) && deny.some((d) => endpointId(d) === endpointId(expected)))
    throw new UnsafeDatabaseError('EXPERIMENT_DB_HOST is itself on the deny list');
  return host;
}

// Load .env.experiment into process.env (overwriting), run the guard, return the host.
export function loadExperimentEnv(argv: string[] = process.argv): string {
  const i = argv.indexOf('--env-file');
  const path = i >= 0 ? argv[i + 1] : join(ROOT, '.env.experiment');
  if (!existsSync(path)) throw new UnsafeDatabaseError(`env file not found: ${path}`);
  const env = parseEnvFile(readFileSync(path, 'utf8'));
  const host = assertSafeDatabase(env);
  for (const k of ['DATABASE_URL', 'EXPERIMENT_DB_HOST', 'PROD_DB_HOST_DENYLIST', 'OPENROUTER_API_KEY']) {
    if (env[k] !== undefined) process.env[k] = env[k];
    else delete process.env[k];
  }
  return host;
}

// Run a script body only after the guard passes; print a clean refusal otherwise.
export async function guarded(main: (host: string) => Promise<void>): Promise<void> {
  let host: string;
  try {
    host = loadExperimentEnv();
  } catch (e) {
    if (e instanceof UnsafeDatabaseError) {
      console.error(`REFUSED: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
  console.log(`experiment database: ${endpointId(host)} (guard passed)`);
  await main(host);
}
