import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../lib/server/config";
import { getActiveSeasonId, queryRows } from "../../../lib/server/database";
import { getSeasonPhase, type SeasonSchedule } from "../../../lib/server/season-window";
import { fetchPumpLeaderboard, type FantasyPlayer } from "../../../lib/server/pumpfun";
import { saveRosterSnapshot } from "../../../lib/server/players";
import top50Snapshot from "../../../data/pumpfun-one-month-top50.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type SnapshotTuple = [number, string, string, number, string];

function datedFallback() {
  const players: FantasyPlayer[] = (top50Snapshot.players as SnapshotTuple[]).map(([rank, wallet, displayName, pnlUsd, avatarUrl]) => ({
    id: `rank-${String(rank).padStart(2, "0")}`,
    rank,
    wallet,
    display_name: displayName,
    profile_url: `https://pump.fun/profile/${wallet}`,
    avatar_url: avatarUrl,
    pnl_usd: pnlUsd,
  }));
  return NextResponse.json({ configured: false, live: false, source: "dated fallback snapshot", sourceUrl: top50Snapshot.sourceUrl, snapshotAt: top50Snapshot.snapshotAt, players });
}

async function getLiveBoard() {
  try {
    const board = await fetchPumpLeaderboard(50);
    return NextResponse.json({ configured: true, live: true, source: "Pump.fun monthly PnL leaderboard", sourceUrl: "https://pump.fun/leaderboard", ...board });
  } catch {
    return datedFallback();
  }
}

export async function GET() {
  try {
    const config = getBackendConfig();
    const season = config.databaseUrl ? await getActiveSeasonId() : null;
    if (!config.databaseUrl || !season) return getLiveBoard();

    const [seasons, savedPlayers] = await Promise.all([
      queryRows<SeasonSchedule>("select status, opens_at, locked_at, closes_at from pf_seasons where id = $1 limit 1", [season]),
      queryRows<FantasyPlayer & { season_id: string; snapshot_at: string }>("select id, rank, wallet, display_name, profile_url, avatar_url, pnl_usd, snapshot_at from pf_players where season_id = $1 order by rank asc limit 50", [season]),
    ]);
    if (savedPlayers.length === 50) {
      return NextResponse.json({ configured: true, live: false, source: "season roster snapshot", seasonId: season, snapshotAt: savedPlayers[0]?.snapshot_at ?? null, players: savedPlayers.map((player) => ({ ...player, pnl_usd: Number(player.pnl_usd) })) });
    }
    const seasonRow = seasons[0];
    const phase = seasonRow ? getSeasonPhase(seasonRow) : "inactive";
    if (seasonRow && (phase === "draft" || phase === "live") && savedPlayers.length === 0) {
      const board = await fetchPumpLeaderboard(50, { fresh: true });
      if (board.players.length !== 50 || new Set(board.players.map((player) => player.wallet)).size !== 50) return getLiveBoard();
      const observedAt = new Date();
      await saveRosterSnapshot(season, board.players, observedAt);
      return NextResponse.json({ configured: true, live: false, source: "season opening snapshot", seasonId: season, snapshotAt: observedAt.toISOString(), players: board.players });
    }
    return getLiveBoard();
  } catch {
    return getLiveBoard();
  }
}
