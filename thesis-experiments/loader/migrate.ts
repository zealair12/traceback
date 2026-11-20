// Apply Traceback's own Prisma migrations (server/prisma/migrations) to the
// experiment database, after the safety guard passes. Uses the server's Prisma
// CLI and schema, so the experiment schema is exactly the app's schema.
// Usage: tsx loader/migrate.ts [status|deploy]   (default: status)

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../lib/config.js';
import { guarded } from '../lib/env.js';

const SERVER = join(ROOT, '..', 'server');
const cmd = process.argv[2] === 'deploy' ? 'deploy' : 'status';

await guarded(async () => {
  const r = spawnSync(join(SERVER, 'node_modules/.bin/prisma'), ['migrate', cmd, '--schema', 'prisma/schema.prisma'], {
    cwd: SERVER,
    // process.env.DATABASE_URL was just overwritten from .env.experiment by the guard.
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    encoding: 'utf8'
  });
  // Prisma prints the datasource as host:port only, never the password, but strip
  // any credentials defensively before echoing.
  const scrub = (s: string) => s.replace(/postgres(ql)?:\/\/[^@\s]+@/g, 'postgresql://***@');
  process.stdout.write(scrub(r.stdout ?? ''));
  process.stderr.write(scrub(r.stderr ?? ''));
  process.exit(r.status ?? 1);
});
