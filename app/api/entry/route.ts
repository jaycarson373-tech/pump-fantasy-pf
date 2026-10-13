import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../lib/server/config";
import { getActiveSeasonId, queryRows } from "../../../lib/server/database";
import { routeError, sameOrigin } from "../../../lib/server/http";
import { getWalletSession } from "../../../lib/server/session";
import { getHolderBalance } from "../../../lib/server/solana";
import { canSubmitSeasonEntry, getSeasonPhase, type SeasonSchedule } from "../../../lib/server/season-window";

export const runtime = "nodejs";
type Player = { id: string; rank: number; wallet: string };

export async function GET() {
  try {
    const config = getBackendConfig();
    if (!config.ready) return NextResponse.json({ configured: false, seasonConfigured: false, phase: "unconfigured", entry: null });
    const season = await getActiveSeasonId();
    if (!season) return NextResponse.json({ configured: true, seasonConfigured: false, phase: "inactive", entry: null });
    const seasons = await queryRows<SeasonSchedule>("select status, opens_at, locked_at, closes_at from pf_seasons where id = $1 limit 1", [season]);
    const seasonRow = seasons[0];
    const phase = seasonRow ? getSeasonPhase(seasonRow) : "inactive";
    const schedule = seasonRow ? { opensAt: seasonRow.opens_at, lockedAt: seasonRow.locked_at, closesAt: seasonRow.closes_at } : null;
    const wallet = await getWalletSession();
    if (!wallet) return NextResponse.json({ configured: true, authenticated: false, seasonConfigured: phase !== "misconfigured" && phase !== "inactive", phase, schedule, entry: null });
    const entries = await queryRows<{ picks: string[]; created_at: string; updated_at: string }>("select picks, created_at, updated_at from pf_entries where wallet = $1 and season_id = $2 limit 1", [wallet, season]);
    return NextResponse.json({ configured: true, authenticated: true, wallet, seasonConfigured: phase !== "misconfigured" && phase !== "inactive", phase, schedule, entry: entries[0] ?? null });
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
    const season = await getActiveSeasonId();
    if (!season) return NextResponse.json({ error: "No active season has been configured." }, { status: 503 });
    const seasonRows = await queryRows<SeasonSchedule>("select status, opens_at, locked_at, closes_at from pf_seasons where id = $1 limit 1", [season]);
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
    const players = await queryRows<Player>("select id, rank, wallet from pf_players where season_id = $1 and id = any($2::text[])", [season, picks]);
    const bands = new Set(players.map((player) => Math.floor((player.rank - 1) / 10)));
    if (players.length !== 5 || bands.size !== 5 || [...bands].some((band) => band < 0 || band > 4)) return NextResponse.json({ error: "Each pick must be a current player from a different top-50 rank band." }, { status: 400 });
    const saved = await queryRows<{ wallet: string }>("insert into pf_entries (season_id, wallet, picks, token_balance_raw, updated_at) select s.id, $2, $3::jsonb, $4, now() from pf_seasons s where s.id = $1 and s.status = 'open' and s.opens_at <= now() and s.locked_at > now() and s.closes_at > now() on conflict (season_id, wallet) do update set picks = excluded.picks, token_balance_raw = excluded.token_balance_raw, updated_at = now() where exists (select 1 from pf_seasons s where s.id = excluded.season_id and s.status = 'open' and s.opens_at <= now() and s.locked_at > now() and s.closes_at > now()) returning wallet", [season, wallet, JSON.stringify(picks), eligible.rawBalance]);
    if (saved.length !== 1) return NextResponse.json({ error: "The draft closed before your lineup could be saved. Refresh the season status." }, { status: 409 });
    return NextResponse.json({ ok: true, eligible: true, wallet, picks, tokenBalance: eligible.displayBalance });
  } catch (error) {
    return routeError(error);
  }
}
