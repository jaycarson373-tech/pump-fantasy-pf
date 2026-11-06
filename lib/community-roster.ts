export const RANKED_ROSTER_SIZE = 50;
export const RANK_BAND_SIZE = 10;
export const COMMUNITY_FETCH_LIMIT = 100;
const OBSERVATION_MAX_AGE_MS = 60_000;
export type SquadPlayer = { id: string; wallet: string; rank: number };

export function squadSizeForSeason(id: string): 5 | 6 {
  const match = /^season-([1-9]\d*)$/.exec(id);
  return match && Number(match[1]) >= 2 ? 6 : 5;
}

export function validateSquad(picks: unknown, players: SquadPlayer[], squadSize: number): picks is string[] {
  if (squadSize !== 5 && squadSize !== 6) return false;
  if (!Array.isArray(picks) || picks.length !== squadSize || new Set(picks).size !== squadSize) return false;
  if (picks.some(id => typeof id !== "string" || id.length > 160)) return false;
  const byId = new Map(players.map(player => [player.id, player]));
  const selected = picks.map(id => byId.get(id));
  if (selected.some(player => !player)) return false;
  const roster = selected as SquadPlayer[];
  if (new Set(roster.map(player => player.wallet)).size !== squadSize) return false;
  const ranked = roster.filter(player => player.rank >= 1 && player.rank <= RANKED_ROSTER_SIZE);
  const bands = new Set(ranked.map(player => Math.floor((player.rank - 1) / RANK_BAND_SIZE)));
  return ranked.length === 5 && bands.size === 5 && roster.filter(player => player.rank > RANKED_ROSTER_SIZE).length === squadSize - 5;
}

/** Fetch only distinct drafted community wallets; failed observations stay missing. */
export async function fetchPickedCommunityPnl(
  players: SquadPlayer[], picks: string[],
  fetchPnl: (wallet: string) => Promise<{ pnl_usd: number; observedAt: string }>,
) {
  const pickedIds = new Set(picks);
  const wallets = [...new Set(players.filter(player => player.rank > RANKED_ROSTER_SIZE && pickedIds.has(player.id)).map(player => player.wallet))];
  if (wallets.length > COMMUNITY_FETCH_LIMIT) throw new Error("Community scoring exceeds its request bound. Increase the reviewed scoring budget before retrying.");
  const values: Record<string, number> = {};
  for (const wallet of wallets) {
    try {
      const result = await fetchPnl(wallet);
      const age = Date.now() - Date.parse(result.observedAt);
      if (Number.isFinite(result.pnl_usd) && Number.isFinite(age) && age >= -OBSERVATION_MAX_AGE_MS && age <= OBSERVATION_MAX_AGE_MS) values[wallet] = result.pnl_usd;
    } catch {
      // The snapshot's missing-wallet list records provider failures for review.
    }
  }
  return values;
}
