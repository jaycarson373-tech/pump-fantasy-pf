import "server-only";
import archive from "../../data/pumpfun-one-month-top50.json" with { type: "json" };
import { queryRows } from "./database";
import { validWallet } from "./http";
import { fetchPumpLeaderboard, type FantasyPlayer } from "./pumpfun";

type SavedRoster = { players: FantasyPlayer[]; observed_at: Date | string };

export function archivedRoster() {
  const players: FantasyPlayer[] = archive.players.map(([rank, wallet, name, pnl, avatar]) => ({
    id: `rank-${String(rank).padStart(2,"0")}`, rank: Number(rank), wallet: String(wallet), display_name: String(name),
    pnl_usd: Number(pnl), avatar_url: String(avatar), profile_url: `https://pump.fun/profile/${wallet}`,
  }));
  return { players, snapshotAt: archive.snapshotAt };
}

function validateRoster(players: FantasyPlayer[]) {
  if (players.length !== 50 || players.some((p,index) => p.rank !== index+1 || !validWallet(p.wallet) || !Number.isFinite(p.pnl_usd)) || new Set(players.map(p=>p.wallet)).size !== 50)
    throw new Error("Saved roster requires 50 unique wallets in rank order. Restore a complete roster snapshot.");
}

/** Candidate field for future drafts only. Scoring always uses fresh snapshots. */
export async function getDraftRoster() {
  const seed = archivedRoster();
  validateRoster(seed.players);
  await queryRows("insert into pf_roster_cache(id,players,observed_at) values(1,$1::jsonb,$2) on conflict(id) do nothing", [JSON.stringify(seed.players),seed.snapshotAt]);
  // Claim the attempt before HTTP: outages and process restarts cannot cause a
  // request on every page view. Other callers immediately receive the saved field.
  const claim = await queryRows("update pf_roster_cache set last_refresh_attempt_at=now() where id=1 and (last_refresh_attempt_at is null or last_refresh_attempt_at <= now()-interval '24 hours') returning id");
  if (claim.length) {
    try {
      const board = await fetchPumpLeaderboard(50,{fresh:true});
      validateRoster(board.players);
      await queryRows("update pf_roster_cache set players=$1::jsonb,observed_at=$2 where id=1",[JSON.stringify(board.players),board.snapshotAt]);
    } catch {
      // Operator-approved policy: retain the last saved 50 and their real date.
      // Never feed this cache into scoring or turn a refresh failure into fresh PnL.
    }
  }
  const [saved] = await queryRows<SavedRoster>("select players,observed_at from pf_roster_cache where id=1");
  validateRoster(saved.players);
  return { players:saved.players, snapshotAt:new Date(saved.observed_at).toISOString() };
}
