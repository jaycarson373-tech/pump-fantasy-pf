import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to apply Pump Fantasy migrations.");
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000, ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined });
try {
  await pool.query("create table if not exists public.pf_schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const dir = resolve("db/migrations");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const already = await pool.query("select 1 from public.pf_schema_migrations where name = $1", [name]);
    if (already.rowCount) continue;
    const sql = await readFile(resolve(dir, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into public.pf_schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
