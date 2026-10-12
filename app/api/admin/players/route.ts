import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseRequest } from "../../../../lib/server/config";
import { routeError, sameOrigin, validWallet } from "../../../../lib/server/http";

export const runtime = "nodejs";

type IncomingPlayer = { rank: number; wallet: string; displayName?: string | null; profileUrl?: string | null; avatarUrl?: string | null; pnlUsd: number; contestChangeUsd: number | null };

function verifySecret(supplied: string, expected: string) {
  const left = createHmac("sha256", "pf-ingest").update(supplied).digest();
  const right = createHmac("sha256", "pf-ingest").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const secret = process.env.PF_DATA_INGEST_SECRET;
    const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!secret || !verifySecret(authorization, secret)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    const body = await request.json() as { sourceUrl?: string; observedAt?: string; players?: IncomingPlayer[] };
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
    const observedAt = typeof body.observedAt === "string" ? new Date(body.observedAt) : new Date();
    const players = body.players;
    let validSource = false;
    try { const parsed = new URL(sourceUrl); validSource = parsed.protocol === "https:" && parsed.hostname === "pump.fun" && parsed.pathname === "/leaderboard"; } catch { validSource = false; }
    if (!validSource || Number.isNaN(observedAt.getTime()) || observedAt.getTime() > Date.now() + 5 * 60_000 || !Array.isArray(players) || players.length !== 50) {
      return NextResponse.json({ error: "Provide a Pump.fun leaderboard URL, valid observation time, and exactly 50 player records." }, { status: 400 });
    }
    const season = process.env.PF_ACTIVE_SEASON_ID;
    if (!season || !/^[a-zA-Z0-9_-]{1,64}$/.test(season)) return NextResponse.json({ error: "Configure a valid active round ID before importing players." }, { status: 503 });
    const ranks = new Set<number>();
    const wallets = new Set<string>();
    for (const player of players) {
      if (!Number.isInteger(player.rank) || player.rank < 1 || player.rank > 50 || !validWallet(player.wallet) || !Number.isFinite(player.pnlUsd) || (player.contestChangeUsd !== null && !Number.isFinite(player.contestChangeUsd))) {
        return NextResponse.json({ error: "Player rows contain invalid ranks, wallet addresses, or PnL values." }, { status: 400 });
      }
      ranks.add(player.rank);
      wallets.add(player.wallet);
      if (player.profileUrl && !player.profileUrl.startsWith("https://")) return NextResponse.json({ error: "Profile links must use HTTPS." }, { status: 400 });
      if (player.avatarUrl) {
        try { const avatar = new URL(player.avatarUrl); if (avatar.protocol !== "https:" || !["socialimages.pump.fun", "pump.mypinata.cloud"].includes(avatar.hostname)) return NextResponse.json({ error: "Avatar must come from an approved Pump.fun image host." }, { status: 400 }); }
        catch { return NextResponse.json({ error: "Avatar URL is invalid." }, { status: 400 }); }
      }
    }
    if (ranks.size !== 50 || wallets.size !== 50) return NextResponse.json({ error: "Every rank and wallet must be unique." }, { status: 400 });
    const seasons = await supabaseRequest<Array<{ status: string }>>(`pf_seasons?id=eq.${encodeURIComponent(season)}&select=status&limit=1`);
    if (!seasons.length || !["draft", "open"].includes(seasons[0].status)) return NextResponse.json({ error: "Create the round in draft or open status before importing its roster." }, { status: 409 });
    const current = await supabaseRequest<Array<{ rank: number; wallet: string }>>(`pf_players?season_id=eq.${encodeURIComponent(season)}&select=rank,wallet&order=rank.asc&limit=50`);
    if (current.length && (current.length !== 50 || current.some((row) => players.find((item) => item.rank === row.rank)?.wallet !== row.wallet))) {
      return NextResponse.json({ error: "This season's top-50 roster is already fixed. Refresh its PnL without replacing wallets or changing rank bands." }, { status: 409 });
    }
    const payload = players.map((player) => ({
      id: `${season}-rank-${String(player.rank).padStart(2, "0")}`,
      season_id: season,
      rank: player.rank,
      wallet: player.wallet,
      display_name: player.displayName?.slice(0, 64) ?? null,
      profile_url: player.profileUrl ?? null,
      avatar_url: player.avatarUrl ?? null,
      pnl_usd: player.pnlUsd,
      contest_change_usd: player.contestChangeUsd,
      source_url: sourceUrl,
      snapshot_at: observedAt.toISOString(),
      updated_at: new Date().toISOString(),
    }));
    await supabaseRequest("pf_players?on_conflict=season_id,rank", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(payload) });
    await supabaseRequest("pf_snapshots", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify([{ season_id: season, source_url: sourceUrl, observed_at: observedAt.toISOString(), player_count: 50 }]) });
    return NextResponse.json({ ok: true, accepted: 50, observedAt: observedAt.toISOString(), scoringReady: players.every((player) => typeof player.contestChangeUsd === "number") });
  } catch (error) {
    return routeError(error);
  }
}
