import { NextResponse } from "next/server";
import { getBackendConfig, supabaseRequest } from "../../../lib/server/config";
import { routeError } from "../../../lib/server/http";
import { fetchPumpLeaderboard } from "../../../lib/server/pumpfun";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!getBackendConfig().ready) return NextResponse.json({ configured: false, standings: [] });
    const season = process.env.PF_ACTIVE_SEASON_ID;
    if (!season) return NextResponse.json({ configured: false, standings: [] });
    const entries = await supabaseRequest<Array<{ wallet: string; picks: string[] }>>(`pf_entries?season_id=eq.${encodeURIComponent(season)}&select=wallet,picks`);
    if (!entries.length) return NextResponse.json({ configured: true, standings: [] });
    const [seasonPlayers, board] = await Promise.all([
      supabaseRequest<Array<{ id: string; rank: number; display_name: string | null; wallet: string; pnl_usd: number }>>(`pf_players?season_id=eq.${encodeURIComponent(season)}&select=id,rank,display_name,wallet,pnl_usd&order=rank.asc&limit=50`),
      fetchPumpLeaderboard(100),
    ]);
    const byId = new Map(seasonPlayers.map((player) => [player.id, player]));
    const currentByWallet = new Map(board.players.map((player) => [player.wallet, player]));
    const standings = entries.map((entry) => {
      const roster = entry.picks.map((id) => {
        const player = byId.get(id);
        const current = player ? currentByWallet.get(player.wallet) : undefined;
        return player && current ? { id: player.id, rank: player.rank, display_name: player.display_name, wallet: player.wallet, pnl_usd: current.pnl_usd, contest_change_usd: current.pnl_usd - player.pnl_usd } : undefined;
      }).filter((player) => player !== undefined);
      const complete = roster.length === 5;
      return { wallet: entry.wallet, picks: roster, score: complete ? roster.reduce((sum, player) => sum + player.contest_change_usd, 0) : null, scoringReady: complete };
    }).sort((a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY));
    return NextResponse.json({ configured: true, standings });
  } catch (error) {
    return routeError(error);
  }
}
