import "server-only";
import { queryRows } from "./database";
import type { FantasyPlayer } from "./pumpfun";

export async function saveRosterSnapshot(seasonId: string, players: FantasyPlayer[], observedAt = new Date()) {
  const rows = players.map((player) => [
    `${seasonId}-rank-${String(player.rank).padStart(2, "0")}`,
    seasonId,
    player.rank,
    player.wallet,
    player.display_name,
    player.profile_url,
    player.avatar_url,
    player.pnl_usd,
    "https://pump.fun/leaderboard",
    observedAt.toISOString(),
    new Date().toISOString(),
  ]);
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const start = values.length;
    values.push(...row);
    return `(${row.map((_, index) => `$${start + index + 1}`).join(", ")})`;
  });
  await queryRows(
    `insert into pf_players (id, season_id, rank, wallet, display_name, profile_url, avatar_url, pnl_usd, source_url, snapshot_at, updated_at) values ${tuples.join(", ")} on conflict (season_id, rank) do update set wallet = excluded.wallet, display_name = excluded.display_name, profile_url = excluded.profile_url, avatar_url = excluded.avatar_url, pnl_usd = excluded.pnl_usd, source_url = excluded.source_url, snapshot_at = excluded.snapshot_at, updated_at = excluded.updated_at`,
    values,
  );
  await queryRows("insert into pf_snapshots (season_id, source_url, observed_at, player_count) values ($1, $2, $3, $4)", [seasonId, "https://pump.fun/leaderboard", observedAt.toISOString(), players.length]);
}
