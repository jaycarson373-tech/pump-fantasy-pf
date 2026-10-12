import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../../../lib/server/config";
import { getActiveSeasonId, queryRows } from "../../../../../lib/server/database";
import { routeError, sameOrigin, validWallet } from "../../../../../lib/server/http";
import { fetchPumpLeaderboard } from "../../../../../lib/server/pumpfun";
import { saveRosterSnapshot } from "../../../../../lib/server/players";
import { getSeasonPhase, type SeasonSchedule } from "../../../../../lib/server/season-window";
import { getNativeSolBalance } from "../../../../../lib/server/solana";

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
    const seasonId = await getActiveSeasonId();
    if (!seasonId || !/^[a-zA-Z0-9_-]{1,64}$/.test(seasonId)) return NextResponse.json({ error: "The prepared active season row is missing." }, { status: 503 });

    const seasonRows = await queryRows<SeasonSchedule & { id: string; title: string }>("select id, title, status, opens_at, locked_at, closes_at from pf_seasons where id = $1 limit 1", [seasonId]);
    const season = seasonRows[0];
    if (!season) return NextResponse.json({ error: "The configured season row was not found in the database." }, { status: 404 });
    if (season.status !== "draft") return NextResponse.json({ error: "Only a prepared draft season can be started. This season is already open or has ended." }, { status: 409 });

    const entries = await queryRows<{ wallet: string }>("select wallet from pf_entries where season_id = $1 limit 1", [seasonId]);
    if (entries.length) return NextResponse.json({ error: "This season already has entries; refusing to reset its schedule." }, { status: 409 });

    const board = await fetchPumpLeaderboard(50, { fresh: true });
    if (board.players.length !== 50 || board.players.some((player, index) => player.rank !== index + 1 || !validWallet(player.wallet) || !Number.isFinite(player.pnl_usd)) || new Set(board.players.map((player) => player.wallet)).size !== 50) {
      return NextResponse.json({ error: "Pump.fun did not return a complete, consecutive 1–50 leaderboard. Nothing was opened." }, { status: 503 });
    }
    const observedAt = new Date();
    await saveRosterSnapshot(seasonId, board.players, observedAt);

    const opensAt = new Date();
    const lockedAt = new Date(opensAt.getTime() + 3 * 60 * 60 * 1000);
    const closesAt = new Date(lockedAt.getTime() + 48 * 60 * 60 * 1000);
    const prizeText = process.env.PF_DAILY_PRIZE_LAMPORTS || "0";
    const prizeWallet = process.env.PF_PRIZE_WALLET_ADDRESS || "";
    if (!/^\d+$/.test(prizeText) || BigInt(prizeText) <= 0n) return NextResponse.json({ error: "Set the exact daily prize amount in PF_DAILY_PRIZE_LAMPORTS before starting the season." }, { status: 503 });
    if (!validWallet(prizeWallet)) return NextResponse.json({ error: "Set PF_PRIZE_WALLET_ADDRESS to the public treasury wallet that will pay the winners." }, { status: 503 });
    const treasuryBalance = await getNativeSolBalance(prizeWallet);
    const requiredSol = BigInt(prizeText) * 2n + 20_000n;
    if (treasuryBalance < requiredSol) return NextResponse.json({ error: "The prize wallet must hold enough SOL for both daily prizes plus transaction fees before the season opens.", dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredSol.toString(), currentBalanceLamports: treasuryBalance.toString() }, { status: 409 });
    const updated = await queryRows<{ id: string }>("update pf_seasons set status = 'open', opens_at = $2, locked_at = $3, closes_at = $4, daily_prize_lamports = $5 where id = $1 and status = 'draft' returning id", [seasonId, opensAt.toISOString(), lockedAt.toISOString(), closesAt.toISOString(), prizeText]);
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
      openingRosterObservedAt: observedAt.toISOString(),
      openingRosterPlayers: board.players.length,
    });
  } catch (error) {
    return routeError(error);
  }
}
