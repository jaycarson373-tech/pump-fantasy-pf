import "server-only";
import { Pool, type QueryResultRow } from "pg";

declare global {
  // Keep one pool across Next.js hot reloads in development.
  var pumpFantasyPool: Pool | undefined;
}

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Persistent database is not configured.");
  if (!globalThis.pumpFantasyPool) {
    globalThis.pumpFantasyPool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.pumpFantasyPool;
}

export async function queryRows<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  const result = await getPool().query<T>(sql, values);
  return result.rows;
}

export async function closeDatabasePool() {
  if (globalThis.pumpFantasyPool) {
    await globalThis.pumpFantasyPool.end();
    globalThis.pumpFantasyPool = undefined;
  }
}

export async function withAdvisoryLock<T>(key: string, task: () => Promise<T>) {
  const client = await getPool().connect();
  try {
    const locked = await client.query<{ acquired: boolean }>("select pg_try_advisory_lock(hashtext($1)) as acquired", [key]);
    if (!locked.rows[0]?.acquired) return { acquired: false as const, value: null };
    try {
      return { acquired: true as const, value: await task() };
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [key]);
    }
  } finally {
    client.release();
  }
}

export async function getActiveSeasonId() {
  const configured = await queryRows<{ value: string }>("select value from pf_app_config where key = 'active_season_id' limit 1");
  return configured[0]?.value || process.env.PF_ACTIVE_SEASON_ID || null;
}
