import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../lib/server/config";
import { getActiveSeasonId, queryRows } from "../../../lib/server/database";
import { routeError } from "../../../lib/server/http";
import { fetchPumpLeaderboard } from "../../../lib/server/pumpfun";
import { selectStandingsSnapshots } from "../../../lib/server/daily-scoring";
import { getSeasonPhase, type SeasonSchedule } from "../../../lib/server/season-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EntryRow = { wallet: string; picks: string[] };
type Snapshot = { boundary: number; captured_at: string; pnl_by_wallet: Record<string, number>; missing_wallets: string[] };

export async function GET() {
  try {
    if (!getBackendConfig().databaseUrl) return NextResponse.json({ configured: false, standings: [], awards: [] });
    const seasonId = await getActiveSeasonId();
    if (!seasonId) return NextResponse.json({ configured: false, standings: [], awards: [] });
    const [seasons, entries, players, scoreSnapshots] = await Promise.all([
      queryRows<SeasonSchedule & { id: string; daily_prize_lamports: string }>("select id, status, opens_at, locked_at, closes_at, daily_prize_lamports from pf_seasons where id = $1 limit 1", [seasonId]),
      queryRows<EntryRow>("select wallet, picks from pf_entries where season_id = $1 order by created_at asc", [seasonId]),
      queryRows<{ id: string; rank: number; display_name: string | null; wallet: string; pnl_usd: string }>("select id, rank, display_name, wallet, pnl_usd from pf_players where season_id = $1 order by rank asc", [seasonId]),
      queryRows<Snapshot>("select boundary, captured_at, pnl_by_wallet, missing_wallets from pf_score_snapshots where season_id = $1 and boundary in (0, 1, 2) order by boundary asc", [seasonId]),
    ]);
    const season = seasons[0];
    const phase = season ? getSeasonPhase(season) : "inactive";
    const selectedSnapshots = selectStandingsSnapshots(phase, scoreSnapshots);
    const baseline = selectedSnapshots.baseline;
    const board = entries.length && baseline && phase === "live" ? await fetchPumpLeaderboard(100) : null;
    const liveByWallet = new Map(board?.players.map((player) => [player.wallet, player.pnl_usd]) ?? []);
    const byId = new Map(players.map((player) => [player.id, { ...player, pnl_usd: Number(player.pnl_usd) }]));
    const standings = entries.map((entry) => {
      const roster = entry.picks.map((id) => {
        const player = byId.get(id);
        if (!player) return undefined;
        const pnl = phase === "live" ? liveByWallet.get(player.wallet) : selectedSnapshots.current?.pnl_by_wallet[player.wallet];
        const base = baseline?.pnl_by_wallet[player.wallet];
        return { id, rank: player.rank, display_name: player.display_name, wallet: player.wallet, pnl_usd: pnl ?? null, contest_change_usd: pnl !== undefined && base !== undefined ? pnl - base : null };
      }).filter((player) => player !== undefined);
      const complete = roster.length === 5 && roster.every((player) => player.contest_change_usd !== null);
      const score = complete ? roster.reduce((sum, player) => sum + (player.contest_change_usd ?? 0), 0) : null;
      return { wallet: entry.wallet, picks: roster, score, scoringReady: complete };
    }).sort((a, b) => (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY) || a.wallet.localeCompare(b.wallet));
    const allAwards = await queryRows<{ id: string; season_id: string; day_number: number; winner_wallet: string | null; score_usd: string | null; prize_lamports: string; status: string; payment_signature: string | null; paid_at: string | null }>("select id, season_id, day_number, winner_wallet, score_usd, prize_lamports, status, payment_signature, paid_at from pf_daily_awards order by created_at desc limit 10");
    return NextResponse.json({
      configured: true,
      seasonId,
      phase,
      prizeLamports: season?.daily_prize_lamports ?? "0",
      prizeWallet: process.env.PF_PRIZE_WALLET_ADDRESS ?? null,
      scoreSnapshotAt: baseline?.captured_at ?? null,
      standings,
      awards: allAwards.map((award) => ({ ...award, score_usd: award.score_usd === null ? null : Number(award.score_usd) })),
    });
  } catch (error) {
    return routeError(error);
  }
}
