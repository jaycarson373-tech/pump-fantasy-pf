import "server-only";
import { queryRows } from "../database";
import { getBackendConfig } from "../config";
import {
  currentSeason,
  currentRounds,
  shownRound,
  type Roster,
} from "./service";
import { rewardSummary } from "./rewards";
export async function leagueState(
  wallet: string | null,
  requestedRound: string | null = null,
) {
  const base = {
    tokenMint: getBackendConfig().mint ?? null,
    serverTime: new Date().toISOString(),
    season: null,
    round: null,
    rounds: [],
    players: [],
    roster: null,
    boards: { daily: [], weekly: [], season: [] },
    rewards: null,
    scoringDays: [],
    champions: [],
  };
  if (!getBackendConfig().databaseUrl)
    return {
      ...base,
      status: "unavailable",
      message:
        "League services are offline. Your saved draft stays on this device.",
    };
  const season = await currentSeason();
  if (!season)
    return {
      ...base,
      status: "preseason",
      message: "The next draft has not been scheduled.",
    };
  const rounds = await currentRounds(season.id),
    round = rounds.find((r) => r.id === requestedRound) ?? shownRound(rounds);
  if (!round) return { ...base, season, status: "preseason" };
  const rosters = await queryRows<Roster>(
    "select wallet,picks,captain,disqualified_at,disqualification_reason,updated_at from pfl_rosters where round_id=$1",
    [round.id],
  );
  const scores = await queryRows<{
    wallet: string;
    day: number;
    points2: number;
  }>("select wallet,day,points2 from pfl_scores where round_id=$1", [round.id]);
  const days = await queryRows<{
    day: number;
    ends_at: string;
    input_hash: string;
    source: string;
  }>(
    "select day,ends_at,input_hash,source from pfl_days where round_id=$1 order by day",
    [round.id],
  );
  const latest = Math.max(0, ...days.map((d) => d.day));
  const coverage = await queryRows<{ wallet: string; through_at: string }>(
    "select wallet,through_at from pfl_coverage where round_id=$1",
    [round.id],
  );
  const board = (daily: boolean) => {
    const rows = rosters
      .map((r) => ({
        ...r,
        points2: days.length
          ? scores
              .filter(
                (s) => s.wallet === r.wallet && (!daily || s.day === latest),
              )
              .reduce((sum, s) => sum + s.points2, 0)
          : null,
        eligible: r.disqualified_at
          ? "disqualified"
          : coverage.some(
                (c) =>
                  c.wallet === r.wallet &&
                  Date.parse(c.through_at) >=
                    Date.parse(days.at(-1)?.ends_at ?? round.ends_at),
              )
            ? "verified"
            : "pending",
        rankChange: null,
      }))
      .sort(
        (a, b) =>
          (b.points2 ?? -Infinity) - (a.points2 ?? -Infinity) ||
          a.wallet.localeCompare(b.wallet),
      );
    return rows.map((r) => ({
      ...r,
      rank:
        r.points2 === null || r.disqualified_at
          ? null
          : 1 +
            rows.filter(
              (x) =>
                !x.disqualified_at &&
                x.points2 !== null &&
                x.points2 > r.points2!,
            ).length,
    }));
  };
  const seasonBoard = await queryRows<{
    wallet: string;
    points: string;
    fantasy_points: string;
    best_rank: number;
  }>(
    `select w.wallet,sum(w.season_points_bps)::text points,sum(w.points2)::text fantasy_points,min(w.rank) best_rank from pfl_weekly_standings w join pfl_rounds r on r.id=w.round_id where r.season_id=$1 group by w.wallet order by sum(w.season_points_bps) desc,sum(w.points2) desc,min(w.rank),w.wallet`,
    [season.id],
  );
  const rankedSeason = seasonBoard.map((r) => ({
    ...r,
    rank:
      1 +
      seasonBoard.filter(
        (x) =>
          Number(x.points) > Number(r.points) ||
          (x.points === r.points &&
            (Number(x.fantasy_points) > Number(r.fantasy_points) ||
              (x.fantasy_points === r.fantasy_points &&
                x.best_rank < r.best_rank))),
      ).length,
  }));
  return {
    tokenMint: base.tokenMint,
    serverTime: base.serverTime,
    status: round.pool ? "ready" : "awaiting_data",
    message: round.pool
      ? null
      : "The Top 100 field is awaiting a verified ranking snapshot.",
    season,
    round: { ...round, last_error: undefined },
    rounds: rounds.map((r) => ({
      id: r.id,
      week: r.week,
      status: r.status,
      opens_at: r.opens_at,
      locks_at: r.locks_at,
      ends_at: r.ends_at,
    })),
    players: round.pool ?? [],
    roster: rosters.find((r) => r.wallet === wallet) ?? null,
    boards: { daily: board(true), weekly: board(false), season: rankedSeason },
    rewards: await rewardSummary(season.id, wallet),
    scoringDays: days,
    scoringDelayed:
      Math.min(
        7,
        Math.max(
          0,
          Math.floor((Date.now() - Date.parse(round.locks_at)) / 86400000),
        ),
      ) > days.length,
    champions:
      season.status === "complete"
        ? rankedSeason.filter((r) => r.rank === 1)
        : [],
  };
}
