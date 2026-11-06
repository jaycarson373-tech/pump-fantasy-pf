import "server-only";
import { COMMUNITY_FETCH_LIMIT } from "../community-roster";
import type { RowsQuery } from "./database";

/** Must run in the transaction that opens the draft. SHARE blocks registry writes
 * until commit; registrations queued after this cutoff enter the next season. */
export async function saveCommunityRosterSnapshot(seasonId: string, rankedWallets: string[], query: RowsQuery) {
  await query("lock table pf_community_players in share mode");
  const candidates = await query<{ wallet: string }>("select wallet from pf_community_players where not (wallet=any($1::text[])) order by registered_at,wallet limit $2", [rankedWallets, COMMUNITY_FETCH_LIMIT + 1]);
  if (candidates.length > COMMUNITY_FETCH_LIMIT) throw new Error(`The eligible community roster exceeds scoring capacity (${COMMUNITY_FETCH_LIMIT}). Increase the reviewed scoring capacity before opening this season.`);
  if (!candidates.length) throw new Error("No eligible community player is registered. Register a player outside the ranked roster before opening Season 2 or later.");
  await query(`insert into pf_players(id,season_id,rank,wallet,display_name,profile_url,avatar_url,pnl_usd,source_url,snapshot_at)
    select $1 || ':community:' || wallet,$1,50+row_number() over(order by registered_at,wallet),wallet,display_name,profile_url,avatar_url,pnl_usd,profile_url,clock_timestamp()
    from pf_community_players where not (wallet=any($2::text[]))`, [seasonId, rankedWallets]);
  return candidates.length;
}
