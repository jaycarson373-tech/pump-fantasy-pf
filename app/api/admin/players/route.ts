import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { queryRows } from "../../../../lib/server/database";
import { routeError, sameOrigin, validWallet } from "../../../../lib/server/http";

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
    if (!season || !/^[a-zA-Z0-9_-]{1,64}$/.test(season)) return NextResponse.json({ error: "Configure a valid active season ID before importing players." }, { status: 503 });
    const ranks = new Set<number>();
    const wallets = new Set<string>();
    for (const player of players) {
      if (!Number.isInteger(player.rank) || player.rank < 1 || player.rank > 50 || !validWallet(player.wallet) || !Number.isFinite(player.pnlUsd) || (player.contestChangeUsd !== null && !Number.isFinite(player.contestChangeUsd))) return NextResponse.json({ error: "Player rows contain invalid ranks, wallet addresses, or PnL values." }, { status: 400 });
      ranks.add(player.rank); wallets.add(player.wallet);
      if (player.profileUrl && !player.profileUrl.startsWith("https://")) return NextResponse.json({ error: "Profile links must use HTTPS." }, { status: 400 });
      if (player.avatarUrl) {
        try { const avatar = new URL(player.avatarUrl); if (avatar.protocol !== "https:" || !["socialimages.pump.fun", "pump.mypinata.cloud"].includes(avatar.hostname)) return NextResponse.json({ error: "Avatar must come from an approved Pump.fun image host." }, { status: 400 }); }
        catch { return NextResponse.json({ error: "Avatar URL is invalid." }, { status: 400 }); }
      }
    }
    if (ranks.size !== 50 || wallets.size !== 50) return NextResponse.json({ error: "Every rank and wallet must be unique." }, { status: 400 });
    const seasons = await queryRows<{ status: string }>("select status from pf_seasons where id = $1 limit 1", [season]);
    if (!seasons.length || !["draft", "open"].includes(seasons[0].status)) return NextResponse.json({ error: "Create the season in draft or open status before importing players." }, { status: 409 });
    const current = await queryRows<{ rank: number; wallet: string }>("select rank, wallet from pf_players where season_id = $1 order by rank asc limit 50", [season]);
    if (current.length && (current.length !== 50 || current.some((row) => players.find((item) => item.rank === row.rank)?.wallet !== row.wallet))) return NextResponse.json({ error: "This season's top-50 roster is fixed. Do not replace wallets or rank bands." }, { status: 409 });

    const values: unknown[] = [];
    const tuples = players.map((player) => {
      const row = [`${season}-rank-${String(player.rank).padStart(2, "0")}`, season, player.rank, player.wallet, player.displayName?.slice(0, 64) ?? null, player.profileUrl ?? null, player.avatarUrl ?? null, player.pnlUsd, player.contestChangeUsd, sourceUrl, observedAt.toISOString(), new Date().toISOString()];
      const start = values.length;
      values.push(...row);
      return `(${row.map((_, index) => `$${start + index + 1}`).join(", ")})`;
    });
    await queryRows(`insert into pf_players (id, season_id, rank, wallet, display_name, profile_url, avatar_url, pnl_usd, contest_change_usd, source_url, snapshot_at, updated_at) values ${tuples.join(", ")} on conflict (season_id, rank) do update set pnl_usd = excluded.pnl_usd, contest_change_usd = excluded.contest_change_usd, source_url = excluded.source_url, snapshot_at = excluded.snapshot_at, updated_at = excluded.updated_at`, values);
    await queryRows("insert into pf_snapshots (season_id, source_url, observed_at, player_count) values ($1, $2, $3, 50)", [season, sourceUrl, observedAt.toISOString()]);
    return NextResponse.json({ ok: true, accepted: 50, observedAt: observedAt.toISOString(), scoringReady: players.every((player) => typeof player.contestChangeUsd === "number") });
  } catch (error) {
    return routeError(error);
  }
}
