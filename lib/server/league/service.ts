import "server-only";
import { allocateReceipts, prepareRewards } from "./rewards";
import { queryRows, withTransaction, withAdvisoryLock } from "../database";
import { getBackendConfig } from "../config";
import { getHolderBalance, verifyTokenMint } from "../solana";
import {
  DAY,
  makeCalendar,
  makeOpeningCalendar,
  validateRoster,
  draftOpen,
  scoreDay,
  rosterScore,
  weeklyPercentiles,
  eligibleBalance,
  type Trader,
} from "../../league/engine";
import {
  provider,
  hash,
  rankingsEvidence,
  intervalEvidence,
  type RankingEvidence,
  type IntervalEvidence,
  type CoverageEvidence,
} from "./provider";
export type Round = {
  id: string;
  season_id: string;
  week: number;
  opens_at: string;
  locks_at: string;
  ends_at: string;
  status: string;
  pool: Trader[] | null;
  pool_hash: string | null;
  pool_source: string | null;
  pool_observed_at: string | null;
  methodology: string | null;
  last_error: string | null;
};
export type Season = {
  id: string;
  title: string;
  number: number;
  mint: string;
  starts_at: string;
  ends_at: string;
  weeks: number;
  status: string;
};
export type Roster = {
  wallet: string;
  picks: string[];
  captain: string;
  disqualified_at: string | null;
  disqualification_reason: string | null;
  updated_at: string;
};
export async function currentSeason() {
  return (
    (
      await queryRows<Season>(
        "select * from pfl_seasons where status <> 'paused' order by starts_at desc limit 1",
      )
    )[0] ?? null
  );
}
export async function currentRounds(seasonId: string) {
  return queryRows<Round>(
    "select * from pfl_rounds where season_id=$1 order by week",
    [seasonId],
  );
}
export function shownRound(rounds: Round[], now = Date.now()) {
  return (
    rounds.find(
      (r) => now >= Date.parse(r.opens_at) && now < Date.parse(r.locks_at),
    ) ??
    rounds.find(
      (r) => now >= Date.parse(r.locks_at) && now < Date.parse(r.ends_at),
    ) ??
    rounds.find((r) => Date.parse(r.opens_at) > now) ??
    rounds.at(-1) ??
    null
  );
}
export async function createSeason(input: {
  id: string;
  title: string;
  number: number;
  startsAt?: string;
  openingDraftAt?: string;
  weeks?: number;
}) {
  const mint = getBackendConfig().mint;
  if (!mint)
    throw Error("Configure the verified PFL mint before creating a season");
  await verifyTokenMint(mint);
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id) ||
    !input.title ||
    input.title.length > 100 ||
    !Number.isSafeInteger(input.number) ||
    input.number < 1
  )
    throw Error("Invalid season");
  const calendar = input.openingDraftAt
    ? makeOpeningCalendar(input.openingDraftAt, input.weeks ?? 4)
    : makeCalendar(input.startsAt ?? "", input.weeks ?? 4);
  if (Date.parse(calendar[0].opensAt) <= Date.now())
    throw Error("New seasons must be scheduled before drafting opens");
  return withTransaction(async (q) => {
    await q("select pg_advisory_xact_lock(hashtext('pfl-create-season'))");
    const overlap = await q(
      "select id from pfl_seasons where status <> 'paused' and starts_at < $2 and ends_at > $1",
      [calendar[0].opensAt, calendar.at(-1)!.endsAt],
    );
    if (overlap.length)
      throw Error("Season calendar overlaps another league season");
    await q(
      "insert into pfl_seasons(id,title,number,mint,starts_at,ends_at,weeks) values($1,$2,$3,$4,$5,$6,$7)",
      [
        input.id,
        input.title,
        input.number,
        mint,
        calendar[0].locksAt,
        calendar.at(-1)!.endsAt,
        calendar.length,
      ],
    );
    for (const w of calendar)
      await q(
        "insert into pfl_rounds(id,season_id,week,opens_at,locks_at,ends_at) values($1,$2,$3,$4,$5,$6)",
        [
          `${input.id}-w${w.week}`,
          input.id,
          w.week,
          w.opensAt,
          w.locksAt,
          w.endsAt,
        ],
      );
    return { id: input.id, calendar };
  });
}
export async function submitRoster(
  roundId: string,
  wallet: string,
  picks: string[],
  captain: string,
) {
  const balance = await getHolderBalance(wallet);
  if (!eligibleBalance(balance.rawBalance, balance.decimals))
    throw Error("Hold at least 500,000 PFL to submit");
  return withTransaction(async (q) => {
    const [round] = await q<Round>(
      "select * from pfl_rounds where id=$1 for update",
      [roundId],
    );
    if (!round || !draftOpen(round)) throw Error("Draft is closed");
    const [season] = await q<Season>("select * from pfl_seasons where id=$1", [
      round.season_id,
    ]);
    if (season.status === "paused" || season.mint !== getBackendConfig().mint)
      throw Error("Season is unavailable");
    validateRoster(round.pool ?? [], picks, captain);
    const rows = await q<Roster>(
      "insert into pfl_rosters(round_id,wallet,picks,captain,balance_raw) values($1,$2,$3::jsonb,$4,$5) on conflict(round_id,wallet) do update set picks=excluded.picks,captain=excluded.captain,balance_raw=excluded.balance_raw,updated_at=now() returning *",
      [roundId, wallet, JSON.stringify(picks), captain, balance.rawBalance],
    );
    return rows[0];
  });
}
async function disqualify(round: Round, wallet: string, reason: string) {
  await withTransaction(async (q) => {
    await q(
      "update pfl_rosters set disqualified_at=coalesce(disqualified_at,now()),disqualification_reason=$3 where round_id=$1 and wallet=$2",
      [round.id, wallet, reason],
    );
    await q(
      "update pfl_entitlements set status='forfeited' where round_id=$1 and wallet=$2 and status in ('pending','available')",
      [round.id, wallet],
    );
  });
}
async function monitor(round: Round, rosters: Roster[]) {
  for (const r of rosters) {
    if (r.disqualified_at) continue;
    try {
      const b = await getHolderBalance(r.wallet);
      const eligible = eligibleBalance(b.rawBalance, b.decimals);
      await queryRows(
        "insert into pfl_eligibility_events(round_id,wallet,raw_balance,eligible,status,source) values($1,$2,$3,$4,'verified','Solana RPC current balance')",
        [round.id, r.wallet, b.rawBalance, eligible],
      );
      if (!eligible)
        await disqualify(
          round,
          r.wallet,
          "PFL balance fell below 500,000 during the weekly competition",
        );
    } catch {
      await queryRows(
        "insert into pfl_eligibility_events(round_id,wallet,status,source) values($1,$2,'unavailable','Solana RPC')",
        [round.id, r.wallet],
      );
    }
  }
}
async function cover(
  round: Round,
  season: Season,
  rosters: Roster[],
  through: string,
) {
  if (!rosters.length) return;
  const mint = await verifyTokenMint(season.mint);
  for (const r of rosters) {
    if (r.disqualified_at) continue;
    if (
      (
        await queryRows(
          "select 1 from pfl_coverage where round_id=$1 and wallet=$2 and through_at >= $3",
          [round.id, r.wallet, through],
        )
      ).length
    )
      continue;
    const data = await provider<CoverageEvidence>("eligibility", {
      wallet: r.wallet,
      mint: season.mint,
      start: new Date(round.locks_at).toISOString(),
      end: through,
    });
    if (
      data.decimals !== mint.decimals ||
      !data.complete ||
      data.wallet !== r.wallet ||
      data.mint !== season.mint ||
      Date.parse(data.start) !== Date.parse(round.locks_at) ||
      Date.parse(data.end) !== Date.parse(through) ||
      !data.sourceUrl.startsWith("https://")
    )
      throw Error("Historical balance coverage is incomplete");
    if (!eligibleBalance(data.minimumBalanceRaw, data.decimals))
      await disqualify(
        round,
        r.wallet,
        "Indexed balance history fell below 500,000 PFL",
      );
    await queryRows(
      "insert into pfl_coverage(round_id,wallet,through_at,source,input_hash) values($1,$2,$3,$4,$5) on conflict(round_id,wallet) do update set through_at=excluded.through_at,source=excluded.source,input_hash=excluded.input_hash where pfl_coverage.through_at<excluded.through_at",
      [round.id, r.wallet, through, data.sourceUrl, hash(data)],
    );
  }
}
async function scoreInterval(round: Round, day: number) {
  const start = new Date(
      Date.parse(round.locks_at) + (day - 1) * DAY,
    ).toISOString(),
    end = new Date(Date.parse(round.locks_at) + day * DAY).toISOString();
  const data = await provider<IntervalEvidence>("pnl", {
    roundId: round.id,
    start,
    end,
    wallets: (round.pool ?? []).map((p) => p.wallet).join(","),
  });
  const pnl = intervalEvidence(data, start, end, round.methodology!);
  const points = scoreDay(round.pool!, pnl);
  return withTransaction(async (q) => {
    await q("select id from pfl_rounds where id=$1 for update", [round.id]);
    const exists = await q(
      "select day from pfl_days where round_id=$1 and day=$2",
      [round.id, day],
    );
    if (exists.length) return;
    await q(
      "insert into pfl_days(round_id,day,starts_at,ends_at,source,methodology,inputs,input_hash,points) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        round.id,
        day,
        start,
        end,
        data.sourceUrl,
        data.methodology,
        JSON.stringify(data),
        hash(data),
        JSON.stringify(points),
      ],
    );
    const rosters = await q<Roster>(
      "select * from pfl_rosters where round_id=$1",
      [round.id],
    );
    for (const r of rosters) {
      validateRoster(round.pool!, r.picks, r.captain);
      await q(
        "insert into pfl_scores(round_id,day,wallet,points2) values($1,$2,$3,$4)",
        [round.id, day, r.wallet, rosterScore(points, r.picks, r.captain)],
      );
    }
  });
}
async function finishRound(round: Round) {
  return withTransaction(async (q) => {
    const [locked] = await q<Round>(
      "select * from pfl_rounds where id=$1 for update",
      [round.id],
    );
    if (locked.status === "complete") return;
    const [{ count }] = await q<{ count: string }>(
      "select count(*) from pfl_days where round_id=$1",
      [round.id],
    );
    if (Number(count) !== 7) throw Error("All seven daily intervals required");
    const uncovered = await q(
      "select r.wallet from pfl_rosters r left join pfl_coverage c using(round_id,wallet) where r.round_id=$1 and r.disqualified_at is null and (c.through_at is null or c.through_at<$2)",
      [round.id, round.ends_at],
    );
    if (uncovered.length) throw Error("Weekly eligibility coverage required");
    const scores = await q<{ wallet: string; points2: string }>(
      "select r.wallet,sum(s.points2) as points2 from pfl_rosters r join pfl_scores s using(round_id,wallet) where r.round_id=$1 and r.disqualified_at is null group by r.wallet",
      [round.id],
    );
    for (const r of weeklyPercentiles(
      scores.map((s) => ({ wallet: s.wallet, points2: Number(s.points2) })),
    ))
      await q(
        "insert into pfl_weekly_standings(round_id,wallet,rank,points2,season_points_bps) values($1,$2,$3,$4,$5)",
        [round.id, r.wallet, r.rank, r.points2, r.seasonPointsBps],
      );
    await q(
      "update pfl_rounds set status='complete',last_error=null where id=$1",
      [round.id],
    );
  });
}
export async function tickLeague() {
  if (process.env.PF_LEAGUE_WORKER_ENABLED !== "true")
    return { action: "paused" };
  return withAdvisoryLock("pfl-starting-seven-worker", async () => {
    const season = await currentSeason();
    if (!season) return { action: "idle" };
    if (season.mint !== getBackendConfig().mint)
      throw Error("Configured mint does not match the season");
    await allocateReceipts(season);
    const rounds = await currentRounds(season.id);
    for (const round of rounds) {
      const now = Date.now();
      if (now < Date.parse(round.opens_at) || round.status === "complete")
        continue;
      try {
        if (!round.pool) {
          const data = await provider<RankingEvidence>("rankings", {
            at: new Date(round.opens_at).toISOString(),
            limit: "100",
            periodDays: "30",
          });
          const players = rankingsEvidence(data, round.opens_at);
          await queryRows(
            "update pfl_rounds set pool=$2,pool_hash=$3,pool_source=$4,pool_observed_at=$5,methodology=$6,status=$7,last_error=null where id=$1 and pool is null",
            [
              round.id,
              JSON.stringify(players),
              hash(players),
              data.sourceUrl,
              data.observedAt,
              data.methodology,
              now < Date.parse(round.locks_at) ? "open" : "locked",
            ],
          );
          round.pool = players;
          round.methodology = data.methodology;
        }
        if (now >= Date.parse(round.locks_at)) {
          await queryRows(
            "update pfl_rounds set status='locked' where id=$1 and status<>'complete'",
            [round.id],
          );
          const rosters = await queryRows<Roster>(
            "select * from pfl_rosters where round_id=$1",
            [round.id],
          );
          if (now < Date.parse(round.ends_at)) await monitor(round, rosters);
          const completed = Math.min(
            7,
            Math.floor((now - Date.parse(round.locks_at)) / DAY),
          );
          for (let day = 1; day <= completed; day++) {
            if (
              !(
                await queryRows(
                  "select day from pfl_days where round_id=$1 and day=$2",
                  [round.id, day],
                )
              ).length
            )
              await scoreInterval(round, day);
          }
          if (completed > 0)
            await cover(
              round,
              season,
              rosters,
              new Date(
                Date.parse(round.locks_at) + completed * DAY,
              ).toISOString(),
            );
          if (completed === 7) await finishRound(round);
        }
        await queryRows("update pfl_rounds set last_error=null where id=$1", [
          round.id,
        ]);
      } catch (error) {
        await queryRows("update pfl_rounds set last_error=$2 where id=$1", [
          round.id,
          error instanceof Error ? error.message : "Data unavailable",
        ]);
      }
    }
    const pending = await queryRows(
      "select id from pfl_rounds where season_id=$1 and status<>'complete'",
      [season.id],
    );
    await queryRows("update pfl_seasons set status=$2 where id=$1", [
      season.id,
      pending.length ? "active" : "complete",
    ]);
    await prepareRewards({
      ...season,
      status: pending.length ? "active" : "complete",
    });
    await queryRows(
      "insert into pfl_jobs(id,status,last_error) values('league-worker','completed',null) on conflict(id) do update set status='completed',last_error=null,updated_at=now()",
    );
    return { action: "processed", seasonId: season.id };
  });
}
