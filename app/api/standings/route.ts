import { NextResponse } from "next/server";
import { getBackendConfig, supabaseRequest } from "../../../lib/server/config";
import { routeError } from "../../../lib/server/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!getBackendConfig().ready) return NextResponse.json({ configured: false, standings: [] });
    const season = process.env.PF_ACTIVE_SEASON_ID;
    if (!season) return NextResponse.json({ configured: false, standings: [] });
    const entries = await supabaseRequest<Array<{ wallet: string; picks: string[] }>>(`pf_entries?season_id=eq.${encodeURIComponent(season)}&select=wallet,picks`);
    if (!entries.length) return NextResponse.json({ configured: true, standings: [] });
    const allPicks = [...new Set(entries.flatMap((entry) => entry.picks))];
    const filter = allPicks.map((id) => `"${id.replaceAll('"', '')}"`).join(",");
    const players = await supabaseRequest<Array<{ id: string; display_name: string | null; wallet: string; contest_change_usd: number | null }>>(`pf_players?season_id=eq.${encodeURIComponent(season)}&id=in.(${filter})&select=id,display_name,wallet,contest_change_usd`);
    const byId = new Map(players.map((player) => [player.id, player]));
    const standings = entries.map((entry) => {
      const roster = entry.picks.map((id) => byId.get(id)).filter((player) => player !== undefined);
      const complete = roster.length === 5 && roster.every((player) => typeof player.contest_change_usd === "number");
      return { wallet: entry.wallet, picks: roster, score: complete ? roster.reduce((sum, player) => sum + (player.contest_change_usd ?? 0), 0) : null, scoringReady: complete };
    }).sort((a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY));
    return NextResponse.json({ configured: true, standings });
  } catch (error) {
    return routeError(error);
  }
}
