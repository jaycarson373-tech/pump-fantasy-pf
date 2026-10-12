import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getBackendConfig();
  return NextResponse.json({
    ok: true,
    service: "pump-fantasy",
    backendConfigured: config.ready,
    databaseConfigured: Boolean(config.supabaseUrl && config.serviceKey),
    walletChecksConfigured: Boolean(config.rpcUrl && config.mint && config.minimumTokens),
    activeSeasonConfigured: Boolean(process.env.PF_ACTIVE_SEASON_ID),
  });
}
