/** Starting Seven v1. Scores use half-point units; money uses integer base units. */
export const TIERS = [
  { id: "elite", name: "Elite", min: 1, max: 10, picks: 1, color: "#d5ae4e" },
  {
    id: "contenders",
    name: "Contenders",
    min: 11,
    max: 30,
    picks: 2,
    color: "#497fe8",
  },
  {
    id: "challengers",
    name: "Challengers",
    min: 31,
    max: 60,
    picks: 2,
    color: "#24b9a2",
  },
  {
    id: "wildcards",
    name: "Wildcards",
    min: 61,
    max: 100,
    picks: 2,
    color: "#9968e3",
  },
] as const;
export type Trader = {
  id: string;
  wallet: string;
  rank: number;
  name: string;
  avatar: string | null;
  pnlMicros: string;
  roiBps: number | null;
  trades: number;
  sourceUrl: string;
};
export const DAY = 86_400_000;
export const FORMAT = "starting-seven-v1";
export function tierFor(rank: number) {
  const tier = TIERS.find((t) => rank >= t.min && rank <= t.max);
  if (!tier) throw Error("Invalid trader rank");
  return tier;
}
function validWallet(value: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const char of value) n = n * 58n + BigInt(alphabet.indexOf(char));
  const bytes = n === 0n ? 0 : Math.ceil(n.toString(2).length / 8);
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}
export function validatePool(players: Trader[]) {
  if (
    players.length !== 100 ||
    new Set(players.map((p) => p.id)).size !== 100 ||
    new Set(players.map((p) => p.wallet)).size !== 100
  )
    throw Error("Exactly 100 unique qualifying traders required");
  const sorted = [...players].sort((a, b) => a.rank - b.rank);
  for (const [i, p] of sorted.entries()) {
    if (
      p.rank !== i + 1 ||
      !validWallet(p.wallet) ||
      !p.id ||
      p.id.length > 100 ||
      !p.name ||
      p.name.length > 100 ||
      !/^-?\d+$/.test(p.pnlMicros) ||
      !Number.isSafeInteger(p.trades) ||
      p.trades < 1 ||
      (p.roiBps !== null && !Number.isSafeInteger(p.roiBps))
    )
      throw Error("Invalid or unqualified trader");
    if (i && BigInt(sorted[i - 1].pnlMicros) < BigInt(p.pnlMicros))
      throw Error("Rankings must follow net 30-day PnL");
    if (
      !p.sourceUrl.startsWith("https://") ||
      (p.avatar !== null && !p.avatar.startsWith("https://"))
    )
      throw Error("Invalid source URL");
  }
  return sorted;
}
export function validateRoster(
  players: Trader[],
  picks: string[],
  captain: string,
) {
  validatePool(players);
  if (
    !Array.isArray(picks) ||
    picks.length !== 7 ||
    new Set(picks).size !== 7 ||
    !picks.includes(captain)
  )
    throw Error("Select seven unique traders and one captain from your lineup");
  for (const tier of TIERS)
    if (
      picks.filter((id) =>
        players.some((p) => p.id === id && tierFor(p.rank).id === tier.id),
      ).length !== tier.picks
    )
      throw Error(
        `Select ${tier.picks} ${tier.name} trader${tier.picks === 1 ? "" : "s"}`,
      );
}
export function eligibleBalance(raw: string, decimals: number) {
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  )
    throw Error("Invalid token balance");
  return BigInt(raw) >= 500_000n * 10n ** BigInt(decimals);
}
export function draftOpen(
  round: { opens_at: string; locks_at: string; status: string },
  now = Date.now(),
) {
  return (
    round.status === "open" &&
    now >= Date.parse(round.opens_at) &&
    now < Date.parse(round.locks_at)
  );
}
export function makeCalendar(firstMonday: string, weeks = 4) {
  const start = new Date(firstMonday);
  if (
    !Number.isFinite(start.getTime()) ||
    start.getUTCDay() !== 1 ||
    start.getUTCHours() ||
    start.getUTCMinutes() ||
    start.getUTCSeconds() ||
    start.getUTCMilliseconds() ||
    !Number.isInteger(weeks) ||
    weeks < 1 ||
    weeks > 52
  )
    throw Error("Start must be Monday 00:00 UTC; choose 1–52 weeks");
  return Array.from({ length: weeks }, (_, i) => ({
    week: i + 1,
    opensAt: new Date(+start + (i * 7 - 2) * DAY).toISOString(),
    locksAt: new Date(+start + i * 7 * DAY).toISOString(),
    endsAt: new Date(+start + (i + 1) * 7 * DAY).toISOString(),
  }));
}
/** Equal PnL shares the average occupied rank. No wallet-order scoring advantage. */
export function scoreDay(players: Trader[], pnl: Record<string, string>) {
  validatePool(players);
  if (
    Object.keys(pnl).length !== 100 ||
    players.some(
      (p) => typeof pnl[p.id] !== "string" || !/^[-]?\d+$/.test(pnl[p.id]),
    )
  )
    throw Error("Complete interval PnL required for all 100 traders");
  const points: Record<string, number> = {};
  for (const p of players) points[p.id] = 0;
  for (const positive of [true, false]) {
    const rows = players
      .filter((p) =>
        positive ? BigInt(pnl[p.id]) > 0n : BigInt(pnl[p.id]) < 0n,
      )
      .sort((a, b) =>
        BigInt(pnl[a.id]) === BigInt(pnl[b.id])
          ? a.id.localeCompare(b.id)
          : BigInt(pnl[a.id]) > BigInt(pnl[b.id])
            ? -1
            : 1,
      );
    for (let i = 0; i < rows.length;) {
      let end = i + 1;
      while (
        end < rows.length &&
        BigInt(pnl[rows[end].id]) === BigInt(pnl[rows[i].id])
      )
        end++;
      const averageRank = (i + 1 + end) / 2;
      const score = positive
        ? 2 * (rows.length - averageRank + 1)
        : -2 * averageRank;
      for (let j = i; j < end; j++) points[rows[j].id] = score * 2;
      i = end;
    }
  }
  return points;
}
export function rosterScore(
  points: Record<string, number>,
  picks: string[],
  captain: string,
) {
  if (
    picks.length !== 7 ||
    new Set(picks).size !== 7 ||
    !picks.includes(captain) ||
    picks.some((p) => !Number.isSafeInteger(points[p]))
  )
    throw Error("Invalid scoring roster");
  return picks.reduce(
    (sum, p) => sum + points[p] * (p === captain ? 1.5 : 1),
    0,
  );
}
export type Standing = { wallet: string; points2: number };
export function weeklyPercentiles(rows: Standing[]) {
  const sorted = [...rows].sort(
    (a, b) => b.points2 - a.points2 || a.wallet.localeCompare(b.wallet),
  );
  return sorted.map((row) => {
    const above = sorted.filter((r) => r.points2 > row.points2).length;
    const equal = sorted.filter((r) => r.points2 === row.points2).length;
    const rank = above + 1;
    const rank2 = 2 * above + equal + 1;
    return {
      ...row,
      rank,
      seasonPointsBps:
        sorted.length === 1
          ? 10000
          : Math.floor(
              (10000 * (2 * sorted.length - rank2)) / (2 * (sorted.length - 1)),
            ),
    };
  });
}
export function splitFees(raw: bigint) {
  if (raw < 0n) throw Error("Negative receipt");
  const daily = (raw * 30n) / 100n,
    season = (raw * 50n) / 100n;
  return { daily, season, champion: raw - daily - season };
}
/** Split tied prize positions, retain fractional dust and unoccupied positions. */
export function prizeShares(pool: bigint, rows: Standing[], weights: number[]) {
  if (
    pool < 0n ||
    weights.some((w) => !Number.isInteger(w) || w < 0) ||
    weights.reduce((a, b) => a + b, 0) !== 10000
  )
    throw Error("Invalid prize allocation");
  const sorted = [...rows].sort(
    (a, b) => b.points2 - a.points2 || a.wallet.localeCompare(b.wallet),
  );
  const awards: Record<string, bigint> = {};
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].points2 === sorted[i].points2) j++;
    const share =
      (pool * BigInt(weights.slice(i, j).reduce((a, b) => a + b, 0))) /
      10000n /
      BigInt(j - i);
    for (let k = i; k < j; k++) awards[sorted[k].wallet] = share;
    i = j;
  }
  return {
    awards,
    remainder: pool - Object.values(awards).reduce((a, b) => a + b, 0n),
  };
}
export const DAILY_WEIGHTS = [5000, 3000, 2000];
export const SEASON_WEIGHTS = [
  3000, 2000, 1500, 500, 500, 500, 500, 500, 500, 500,
];

export type SeasonStanding = {
  wallet: string;
  points: number;
  fantasyPoints2: number;
  bestRank: number;
};
export function rankSeason(rows: SeasonStanding[]) {
  const better = (a: SeasonStanding, b: SeasonStanding) =>
    a.points > b.points ||
    (a.points === b.points &&
      (a.fantasyPoints2 > b.fantasyPoints2 ||
        (a.fantasyPoints2 === b.fantasyPoints2 && a.bestRank < b.bestRank)));
  return [...rows]
    .sort((a, b) =>
      better(a, b) ? -1 : better(b, a) ? 1 : a.wallet.localeCompare(b.wallet),
    )
    .map((r) => ({ ...r, rank: 1 + rows.filter((x) => better(x, r)).length }));
}
