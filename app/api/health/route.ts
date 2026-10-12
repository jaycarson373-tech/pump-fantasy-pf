import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../lib/server/config";
import { getActiveSeasonId, queryRows } from "../../../lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getBackendConfig();
  let databaseConfigured = false;
  let migrationsApplied = false;
  let activeSeasonConfigured = false;
  if (config.databaseUrl) {
    try {
      const rows = await queryRows<{ players: string | null; entries: string | null; migrations: string | null; migration_count: string }>("select to_regclass('public.pf_players')::text as players, to_regclass('public.pf_entries')::text as entries, to_regclass('public.pf_schema_migrations')::text as migrations, (select count(*)::text from public.pf_schema_migrations) as migration_count");
      databaseConfigured = Boolean(rows[0]?.players && rows[0]?.entries);
      migrationsApplied = Boolean(rows[0]?.migrations && Number(rows[0]?.migration_count) >= 3);
      activeSeasonConfigured = Boolean(await getActiveSeasonId());
    } catch {
      databaseConfigured = false;
    }
  }
  const walletChecksConfigured = Boolean(config.rpcUrl && config.mint && config.minimumTokens);
  return NextResponse.json({
    ok: true,
    service: "pump-fantasy",
    backendConfigured: Boolean(config.ready && databaseConfigured && migrationsApplied && activeSeasonConfigured),
    databaseConfigured,
    migrationsApplied,
    walletChecksConfigured,
    activeSeasonConfigured,
    payoutConfigured: Boolean(process.env.PF_PRIZE_WALLET_ADDRESS && process.env.PF_DAILY_PRIZE_LAMPORTS && /^\d+$/.test(process.env.PF_DAILY_PRIZE_LAMPORTS) && BigInt(process.env.PF_DAILY_PRIZE_LAMPORTS) > 0n),
  });
}
