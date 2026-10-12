import { NextResponse } from "next/server";
import { getBackendConfig, supabaseRequest } from "../../../lib/server/config";
import { routeError, sameOrigin } from "../../../lib/server/http";
import { getWalletSession } from "../../../lib/server/session";
import { getHolderBalance } from "../../../lib/server/solana";
import { canSubmitSeasonEntry, getSeasonPhase, type SeasonSchedule } from "../../../lib/server/season-window";

export const runtime = "nodejs";
type Player = { id: string; rank: number; wallet: string };

export async function GET() {
  try {
    const config = getBackendConfig();
    if (!config.ready) return NextResponse.json({ configured: false, entry: null });
    const wallet = await getWalletSession();
    if (!wallet) return NextResponse.json({ configured: true, authenticated: false, entry: null }, { status: 401 });
    const season = process.env.PF_ACTIVE_SEASON_ID;
    if (!season) return NextResponse.json({ configured: true, authenticated: true, seasonConfigured: false, entry: null });
    const [entries, seasons] = await Promise.all([
      supabaseRequest<Array<{ picks: string[]; created_at: string; updated_at: string }>>(`pf_entries?wallet=eq.${encodeURIComponent(wallet)}&season_id=eq.${encodeURIComponent(season)}&select=picks,created_at,updated_at&limit=1`),
      supabaseRequest<SeasonSchedule[]>(`pf_seasons?id=eq.${encodeURIComponent(season)}&select=status,opens_at,locked_at,closes_at&limit=1`),
    ]);
    const seasonRow = seasons[0];
    const phase = seasonRow ? getSeasonPhase(seasonRow) : "inactive";
    return NextResponse.json({ configured: true, authenticated: true, seasonConfigured: phase !== "misconfigured" && phase !== "inactive", phase, entry: entries[0] ?? null });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const config = getBackendConfig();
    if (!config.ready) return NextResponse.json({ error: "Entry services are not configured.", code: "NOT_CONFIGURED" }, { status: 503 });
    const wallet = await getWalletSession();
    if (!wallet) return NextResponse.json({ error: "Sign in with your wallet first." }, { status: 401 });
    const season = process.env.PF_ACTIVE_SEASON_ID;
    if (!season) return NextResponse.json({ error: "No active season has been configured." }, { status: 503 });
    const seasonRows = await supabaseRequest<SeasonSchedule[]>(`pf_seasons?id=eq.${encodeURIComponent(season)}&select=status,opens_at,locked_at,closes_at&limit=1`);
    const seasonRow = seasonRows[0];
    if (!seasonRow) return NextResponse.json({ error: "The active season does not exist." }, { status: 503 });
    const phase = getSeasonPhase(seasonRow);
    if (phase === "misconfigured") return NextResponse.json({ error: "The season schedule is incomplete or invalid." }, { status: 503 });
    if (!canSubmitSeasonEntry(seasonRow)) return NextResponse.json({ error: phase === "scheduled" ? "The draft window has not opened yet." : "The three-hour draft window is closed." }, { status: 409 });
    const body = await request.json();
    const picks = body.picks;
    if (!Array.isArray(picks) || picks.length !== 5 || picks.some((id) => typeof id !== "string" || id.length > 100) || new Set(picks).size !== 5) {
      return NextResponse.json({ error: "Choose exactly five different traders, one from each rank band." }, { status: 400 });
    }
    const eligible = await getHolderBalance(wallet);
    if (!eligible.eligible) return NextResponse.json({ error: `Hold at least ${eligible.minimumTokens} tokens to submit an eligible lineup.`, code: "NOT_ELIGIBLE" }, { status: 403 });
    const idFilter = picks.map((id) => `"${id.replaceAll('"', '')}"`).join(",");
    const players = await supabaseRequest<Player[]>(`pf_players?season_id=eq.${encodeURIComponent(season)}&id=in.(${idFilter})&select=id,rank,wallet`);
    const bands = new Set(players.map((player) => Math.floor((player.rank - 1) / 10)));
    if (players.length !== 5 || bands.size !== 5 || [...bands].some((band) => band < 0 || band > 4)) return NextResponse.json({ error: "Each pick must be a current player from a different top-50 rank band." }, { status: 400 });
    await supabaseRequest("pf_entries?on_conflict=season_id,wallet", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{ season_id: season, wallet, picks, token_balance_raw: eligible.rawBalance, updated_at: new Date().toISOString() }]),
    });
    return NextResponse.json({ ok: true, eligible: true, wallet, picks, tokenBalance: eligible.displayBalance });
  } catch (error) {
    return routeError(error);
  }
}
