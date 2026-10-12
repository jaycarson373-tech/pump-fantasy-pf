import { NextResponse } from "next/server";
import { getBackendConfig, supabaseRequest } from "../../../lib/server/config";
import { routeError } from "../../../lib/server/http";
import { getSeasonPhase, type SeasonSchedule } from "../../../lib/server/season-window";
import { fetchPumpLeaderboard, type FantasyPlayer } from "../../../lib/server/pumpfun";
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
    const season = process.env.PF_ACTIVE_SEASON_ID;
    if (!config.ready || !season) return getLiveBoard();

    const [seasons, savedPlayers] = await Promise.all([
      supabaseRequest<SeasonSchedule[]>(`pf_seasons?id=eq.${encodeURIComponent(season)}&select=status,opens_at,locked_at,closes_at&limit=1`),
      supabaseRequest<Array<FantasyPlayer & { season_id: string; snapshot_at: string }>>(`pf_players?season_id=eq.${encodeURIComponent(season)}&select=id,rank,wallet,display_name,profile_url,avatar_url,pnl_usd,snapshot_at&order=rank.asc&limit=50`),
    ]);
    if (savedPlayers.length === 50) {
      return NextResponse.json({ configured: true, live: false, source: "season roster snapshot", snapshotAt: savedPlayers[0]?.snapshot_at ?? null, players: savedPlayers });
    }
    const seasonRow = seasons[0];
    const phase = seasonRow ? getSeasonPhase(seasonRow) : "inactive";
    if (seasonRow && (phase === "draft" || phase === "live") && savedPlayers.length === 0) {
      const board = await fetchPumpLeaderboard(50);
      const observedAt = new Date().toISOString();
      const rows = board.players.map((player) => ({
        id: `${season}-rank-${String(player.rank).padStart(2, "0")}`,
        season_id: season,
        rank: player.rank,
        wallet: player.wallet,
        display_name: player.display_name,
        profile_url: player.profile_url,
        avatar_url: player.avatar_url,
        pnl_usd: player.pnl_usd,
        contest_change_usd: null,
        source_url: "https://pump.fun/leaderboard",
        snapshot_at: observedAt,
        updated_at: observedAt,
      }));
      await supabaseRequest("pf_players?on_conflict=season_id,rank", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      await supabaseRequest("pf_snapshots", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{ season_id: season, source_url: "https://pump.fun/leaderboard", observed_at: observedAt, player_count: 50 }]),
      });
      return NextResponse.json({ configured: true, live: false, source: "season opening snapshot", snapshotAt: observedAt, players: board.players });
    }
    return getLiveBoard();
  } catch (error) {
    return routeError(error);
  }
}
