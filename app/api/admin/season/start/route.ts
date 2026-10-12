import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getBackendConfig, supabaseRequest } from "../../../../../lib/server/config";
import { routeError, sameOrigin, validWallet } from "../../../../../lib/server/http";
import { fetchPumpLeaderboard } from "../../../../../lib/server/pumpfun";
import { getSeasonPhase, type SeasonSchedule } from "../../../../../lib/server/season-window";

export const runtime = "nodejs";

function matchesSecret(supplied: string, expected: string) {
  const left = createHmac("sha256", "pf-admin").update(supplied).digest();
  const right = createHmac("sha256", "pf-admin").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const secret = process.env.PF_DATA_INGEST_SECRET;
    const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!secret || !matchesSecret(authorization, secret)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

    const config = getBackendConfig();
    if (!config.ready) return NextResponse.json({ error: "Backend, RPC, and live token mint must be configured before opening entries." }, { status: 503 });
    const seasonId = process.env.PF_ACTIVE_SEASON_ID;
    if (!seasonId || !/^[a-zA-Z0-9_-]{1,64}$/.test(seasonId)) return NextResponse.json({ error: "Set PF_ACTIVE_SEASON_ID to the prepared season row." }, { status: 503 });

    const seasonRows = await supabaseRequest<Array<SeasonSchedule & { id: string; title: string }>>(
      `pf_seasons?id=eq.${encodeURIComponent(seasonId)}&select=id,title,status,opens_at,locked_at,closes_at&limit=1`,
    );
    const season = seasonRows[0];
    if (!season) return NextResponse.json({ error: "The configured season row was not found in Supabase." }, { status: 404 });
    if (season.status !== "draft") return NextResponse.json({ error: "Only a prepared draft season can be started. This season is already open or has ended." }, { status: 409 });

    const entries = await supabaseRequest<Array<{ wallet: string }>>(`pf_entries?season_id=eq.${encodeURIComponent(seasonId)}&select=wallet&limit=1`);
    if (entries.length) return NextResponse.json({ error: "This season already has entries; refusing to reset its schedule." }, { status: 409 });

    // Capture and persist a fresh official 1M leaderboard as the opening baseline
    // immediately before opening the draft, so submit validation uses the same field.
    const board = await fetchPumpLeaderboard(50, { fresh: true });
    if (board.players.length !== 50 || board.players.some((player, index) => player.rank !== index + 1 || !validWallet(player.wallet) || !Number.isFinite(player.pnl_usd)) || new Set(board.players.map((player) => player.wallet)).size !== 50) {
      return NextResponse.json({ error: "Pump.fun did not return a complete, consecutive 1–50 leaderboard. Nothing was opened." }, { status: 503 });
    }
    const observedAt = new Date().toISOString();
    await supabaseRequest("pf_players?on_conflict=season_id,rank", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(board.players.map((player) => ({
        id: `${seasonId}-rank-${String(player.rank).padStart(2, "0")}`,
        season_id: seasonId,
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
      }))),
    });
    await supabaseRequest("pf_snapshots", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{ season_id: seasonId, source_url: "https://pump.fun/leaderboard", observed_at: observedAt, player_count: 50 }]),
    });

    const opensAt = new Date();
    const lockedAt = new Date(opensAt.getTime() + 3 * 60 * 60 * 1000);
    const closesAt = new Date(lockedAt.getTime() + 48 * 60 * 60 * 1000);
    const updated = await supabaseRequest<Array<{ id: string }>>(
      `pf_seasons?id=eq.${encodeURIComponent(seasonId)}&status=eq.draft&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "open", opens_at: opensAt.toISOString(), locked_at: lockedAt.toISOString(), closes_at: closesAt.toISOString() }),
      },
    );
    if (updated.length !== 1) return NextResponse.json({ error: "Season state changed before launch; refresh the season status and try again." }, { status: 409 });

    return NextResponse.json({
      ok: true,
      seasonId,
      phase: getSeasonPhase({ status: "open", opens_at: opensAt.toISOString(), locked_at: lockedAt.toISOString(), closes_at: closesAt.toISOString() }),
      opensAt: opensAt.toISOString(),
      draftLocksAt: lockedAt.toISOString(),
      seasonEndsAt: closesAt.toISOString(),
      draftHours: 3,
      scoringHours: 48,
      openingRosterObservedAt: observedAt,
      openingRosterPlayers: board.players.length,
    });
  } catch (error) {
    return routeError(error);
  }
}
