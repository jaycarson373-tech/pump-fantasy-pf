import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../lib/server/config";
import { getActiveSeasonId, queryRows } from "../../../lib/server/database";
import type { FantasyPlayer } from "../../../lib/server/pumpfun";
import { archivedRoster, getDraftRoster } from "../../../lib/server/roster-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function datedFallback() {
  return NextResponse.json({ configured: false, live: false, source: "saved roster", sourceUrl: "https://pump.fun/leaderboard", ...archivedRoster() });
}

async function getSavedBoard() {
  try {
    const board = await getDraftRoster();
    return NextResponse.json({ configured: true, live: false, source: "saved monthly roster", sourceUrl: "https://pump.fun/leaderboard", ...board });
  } catch {
    return datedFallback();
  }
}

export async function GET() {
  try {
    const config = getBackendConfig();
    const season = config.databaseUrl ? await getActiveSeasonId() : null;
    if (!config.databaseUrl) return datedFallback();
    if (!season) return getSavedBoard();

    const savedPlayers = await queryRows<FantasyPlayer & { season_id: string; snapshot_at: string }>("select id, rank, wallet, display_name, profile_url, avatar_url, pnl_usd, snapshot_at from pf_players where season_id = $1 order by rank asc limit 50", [season]);
    if (savedPlayers.length === 50) {
      return NextResponse.json({ configured: true, live: false, source: "season roster snapshot", seasonId: season, snapshotAt: savedPlayers[0]?.snapshot_at ?? null, players: savedPlayers.map((player) => ({ ...player, pnl_usd: Number(player.pnl_usd) })) });
    }
    return getSavedBoard();
  } catch {
    return datedFallback();
  }
}
