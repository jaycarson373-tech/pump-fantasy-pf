import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../lib/server/config";
import { getActiveSeasonId, queryRows } from "../../../lib/server/database";
import { hasActiveSeasonRecord, hasRequiredMigrations } from "../../../lib/server/health-readiness";
import { verifyTokenMint } from "../../../lib/server/solana";
import { getPayoutConfiguration } from "../../../lib/server/automatic-payout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getBackendConfig();
  let databaseConfigured = false;
  let migrationsApplied = false;
  let activeSeasonConfigured = false;
  let tokenMintInitialized = false;
  if (config.databaseUrl) {
    try {
      const rows = await queryRows<{ players: string | null; entries: string | null; migrations: string | null; applied_migrations: string[] }>("select to_regclass('public.pf_players')::text as players, to_regclass('public.pf_entries')::text as entries, to_regclass('public.pf_schema_migrations')::text as migrations, (select coalesce(array_agg(name), array[]::text[]) from public.pf_schema_migrations) as applied_migrations");
      databaseConfigured = Boolean(rows[0]?.players && rows[0]?.entries);
      migrationsApplied = Boolean(rows[0]?.migrations && hasRequiredMigrations(rows[0].applied_migrations ?? []));
      const activeSeasonId = await getActiveSeasonId();
      if (activeSeasonId) {
        const seasonRows = await queryRows<{ id: string }>("select id from pf_seasons where id = $1 limit 1", [activeSeasonId]);
        activeSeasonConfigured = hasActiveSeasonRecord(activeSeasonId, seasonRows);
      }
    } catch {
      databaseConfigured = false;
    }
  }
  if (config.rpcUrl && config.mint && config.minimumTokens) {
    try {
      await verifyTokenMint(config.mint);
      tokenMintInitialized = true;
    } catch {
      tokenMintInitialized = false;
    }
  }
  const walletChecksConfigured = Boolean(config.rpcUrl && config.mint && config.minimumTokens && tokenMintInitialized);
  const payout=await getPayoutConfiguration();
  return NextResponse.json({
    ok: true,
    service: "pump-fantasy",
    backendConfigured: Boolean(config.ready && databaseConfigured && migrationsApplied && activeSeasonConfigured && tokenMintInitialized),
    databaseConfigured,
    migrationsApplied,
    walletChecksConfigured,
    tokenMintInitialized,
    activeSeasonConfigured,
    payoutConfigured: payout.blockers.length===0 && (process.env.PF_REWARD_MODE !== "creator-fees" || process.env.PF_FEE_COLLECTION_ENABLED === "true"),
    payoutBlockers: payout.blockers,
    payoutVerification: "Configuration only. Actual paid awards require finalized transfer receipts.",
  });
}
