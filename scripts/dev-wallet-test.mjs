// Isolated, no-prize wallet rehearsal. Reuses the existing test-draft and roster owners.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import pg from 'pg';

const db = new URL(process.env.PF_WALLET_TEST_DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(db.protocol) && !db.search && !db.hash, 'Use a PostgreSQL URL without query parameters or fragment.');
assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname) && /^\/pf_wallet_test_[a-z0-9_]+$/.test(db.pathname), 'Use a new local database named pf_wallet_test_<run>.');
assert.ok(!(await readdir('.')).some(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example'), 'Run from a clean checkout without .env files; this rehearsal must not load production secrets.');
const origin = 'http://127.0.0.1:3187';
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  DATABASE_URL: db.href,
  NEXT_PUBLIC_SITE_URL: origin,
  PUMP_FANTASY_ALLOWED_ORIGINS: 'http://localhost:3187',
  PF_SESSION_SECRET: randomBytes(32).toString('hex'),
  PF_DATA_INGEST_SECRET: randomBytes(32).toString('hex'),
  NEXT_PUBLIC_WALLET_NETWORK: 'devnet',
  NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  FANTASY_MINT_ADDRESS: '11111111111111111111111111111111',
  PF_AUTO_PAYOUT_ENABLED: 'false',
  PF_FEE_COLLECTION_ENABLED: 'false',
  WATCHPACK_POLLING: '1000',
};
// No inherited host, proxy, signer, session or worker settings reach the test process.
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env, env);
const pool = new pg.Pool({ connectionString: db.href, max: 1 });
try {
  const result = await pool.query("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and c.relkind in ('r','p','v','m','S','f')) as occupied");
  assert.equal(result.rows[0].occupied, false, 'Use a fresh empty test database; existing runs are not overwritten.');
} finally {
  await pool.end();
}

function run(args, childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: childEnv, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Local process exited ${code}.`)));
  });
}
await run(['scripts/migrate.mjs'], env);
const source = new URL('../lib/server/', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/server') return next('next/server.js', context);
  const local = context.parentURL?.startsWith(source);
  return next(local && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { archivedRoster } = await import('../lib/server/roster-cache.ts');
const { queryRows, closeDatabasePool } = await import('../lib/server/database.ts');
const { openTestDraft } = await import('../lib/server/test-draft.ts');
try {
  const roster = archivedRoster();
  await queryRows('insert into pf_roster_cache(id,players,observed_at,last_refresh_attempt_at) values(1,$1::jsonb,$2,now())', [JSON.stringify(roster.players), roster.snapshotAt]);
  await openTestDraft();
} finally {
  await closeDatabasePool();
}
process.stdout.write(`Local no-prize wallet draft: ${origin}. Devnet wallet chain; message signing only. Token balances, scoring and payouts are NOT covered.\n`);
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3187'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.once('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
server.once('exit', code => { process.exitCode = code ?? 0; });
