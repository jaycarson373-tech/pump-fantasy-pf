import { NextResponse } from "next/server";
import { getBackendConfig, supabaseRequest } from "../../../lib/server/config";
import { routeError } from "../../../lib/server/http";
import top50Snapshot from "../../../data/pumpfun-one-month-top50.json";

export const runtime = "nodejs";
type SnapshotTuple = [number, string, string, number, string];

export async function GET() {
  try {
    if (!getBackendConfig().supabaseUrl || !getBackendConfig().serviceKey) {
      const players = (top50Snapshot.players as SnapshotTuple[]).map(([rank, wallet, displayName, pnlUsd, avatarUrl]) => ({ id: `rank-${String(rank).padStart(2, "0")}`, rank, wallet, display_name: displayName, profile_url: `https://pump.fun/profile/${wallet}`, avatar_url: avatarUrl, pnl_usd: pnlUsd, contest_change_usd: null }));
      return NextResponse.json({ configured: false, source: "pump.fun 1M snapshot", sourceUrl: top50Snapshot.sourceUrl, snapshotAt: top50Snapshot.snapshotAt, players });
    }
    const season = process.env.PF_ACTIVE_SEASON_ID;
    if (!season) return NextResponse.json({ configured: false, source: "pump.fun 1M snapshot", sourceUrl: top50Snapshot.sourceUrl, snapshotAt: top50Snapshot.snapshotAt, players: (top50Snapshot.players as SnapshotTuple[]).map(([rank, wallet, displayName, pnlUsd, avatarUrl]) => ({ id: `rank-${String(rank).padStart(2, "0")}`, rank, wallet, display_name: displayName, profile_url: `https://pump.fun/profile/${wallet}`, avatar_url: avatarUrl, pnl_usd: pnlUsd, contest_change_usd: null })) });
    const players = await supabaseRequest<Array<{ id: string; rank: number; wallet: string; display_name: string | null; profile_url: string | null; avatar_url: string | null; pnl_usd: number; contest_change_usd: number | null; snapshot_at: string }>>(`pf_players?season_id=eq.${encodeURIComponent(season)}&select=id,rank,wallet,display_name,profile_url,avatar_url,pnl_usd,contest_change_usd,snapshot_at&order=rank.asc&limit=50`);
    if (players.length !== 50) {
      const fallback = (top50Snapshot.players as SnapshotTuple[]).map(([rank, wallet, displayName, pnlUsd, avatarUrl]) => ({ id: `rank-${String(rank).padStart(2, "0")}`, rank, wallet, display_name: displayName, profile_url: `https://pump.fun/profile/${wallet}`, avatar_url: avatarUrl, pnl_usd: pnlUsd, contest_change_usd: null }));
      return NextResponse.json({ configured: false, source: "pump.fun 1M snapshot", sourceUrl: top50Snapshot.sourceUrl, snapshotAt: top50Snapshot.snapshotAt, players: fallback });
    }
    return NextResponse.json({ configured: true, source: "configured data feed", players, snapshotAt: players[0]?.snapshot_at ?? null });
  } catch (error) {
    return routeError(error);
  }
}
