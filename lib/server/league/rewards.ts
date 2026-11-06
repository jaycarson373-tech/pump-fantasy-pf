import "server-only";
import { queryRows, withTransaction } from "../database";
import {
  splitFees,
  DAILY_WEIGHTS,
  SEASON_WEIGHTS,
  prizeShares,
  type Standing,
} from "../../league/engine";
import { hash } from "./provider";
import { getHolderBalance, verifyTokenMint } from "../solana";
import { eligibleBalance, rankSeason } from "../../league/engine";
import type { Season } from "./service";
/** Adopt only finalized, unencumbered receipts after the explicit v2 cutover. */
export async function allocateReceipts(season: Season) {
  const cutover = process.env.PF_LEAGUE_FEE_CUTOVER;
  if (!cutover || !Number.isFinite(Date.parse(cutover))) return;
  await withTransaction(async (q) => {
    await q("select pg_advisory_xact_lock(hashtext('pfl-fee-allocation'))");
    const receipts = await q<{ signature: string; gross_lamports: string }>(
      `select r.signature,r.gross_lamports from pf_creator_fee_receipts r join pf_creator_claims c using(signature)
      where r.competition_format='legacy' and r.mint_address=$1 and c.status='finalized' and r.split_version=2 and r.collected_at>=greatest($2::timestamptz,$3::timestamptz) and r.collected_at<$4
      and r.award_id is null and r.season_award_id is null and not exists(select 1 from pfl_fee_allocations a where a.receipt_signature=r.signature) for update of r`,
      [
        season.mint,
        cutover,
        new Date(Date.parse(season.starts_at) - 2 * 86400000).toISOString(),
        season.ends_at,
      ],
    );
    for (const r of receipts) {
      const s = splitFees(BigInt(r.gross_lamports));
      await q(
        "insert into pfl_fee_allocations(receipt_signature,season_id,daily_raw,season_raw,champion_raw) values($1,$2,$3,$4,$5)",
        [
          r.signature,
          season.id,
          s.daily.toString(),
          s.season.toString(),
          s.champion.toString(),
        ],
      );
    }
  });
}
export async function rewardSummary(seasonId: string, wallet: string | null) {
  const [fees] = await queryRows<{
    received: string;
    daily: string;
    season: string;
    champion: string;
  }>(
    "select coalesce(sum(daily_raw+season_raw+champion_raw),0)::text received,coalesce(sum(daily_raw),0)::text daily,coalesce(sum(season_raw),0)::text season,coalesce(sum(champion_raw),0)::text champion from pfl_fee_allocations where season_id=$1",
    [seasonId],
  );
  const conversions = await queryRows(
    "select c.signature,c.pool,c.token_raw::text,c.mint,c.status,c.confirmed_slot from pfl_conversions c join pfl_fee_allocations a on a.receipt_signature=c.receipt_signature where a.season_id=$1 order by c.created_at desc",
    [seasonId],
  );
  const pools = await queryRows<{ pool: string; raw: string }>(
    "select c.pool,sum(c.token_raw)::text raw from pfl_conversions c join pfl_fee_allocations a on a.receipt_signature=c.receipt_signature where a.season_id=$1 and c.status='verified' group by c.pool",
    [seasonId],
  );
  const personal = wallet
    ? await queryRows(
        "select e.id,e.pool,e.period,e.amount_raw::text,e.status,c.signature,c.status as claim_status from pfl_entitlements e left join pfl_claims c on c.entitlement_id=e.id where e.season_id=$1 and e.wallet=$2 order by e.created_at desc",
        [seasonId, wallet],
      )
    : [];
  const history = await queryRows(
    "select e.wallet,e.pool,e.amount_raw::text,c.signature,c.confirmed_slot from pfl_entitlements e join pfl_claims c on c.entitlement_id=e.id where e.season_id=$1 and c.status='confirmed' order by c.created_at desc limit 50",
    [seasonId],
  );
  let tokenDecimals: number | null = null;
  const [season] = await queryRows<{ mint: string }>(
    "select mint from pfl_seasons where id=$1",
    [seasonId],
  );
  if (season) {
    try {
      tokenDecimals = (await verifyTokenMint(season.mint)).decimals;
    } catch {
      /* Keep token amounts unavailable until decimals can be verified. */
    }
  }
  return {
    fees,
    pools,
    conversions,
    personal,
    history,
    asset: "PFL",
    tokenDecimals,
    payoutsActive: false,
  };
}
/** Called only after verified conversions and final rankings. Positions with no winner carry forward. */
export async function createEntitlements(input: {
  seasonId: string;
  roundId: string | null;
  pool: "daily" | "season" | "champion";
  period: string;
  rows: Standing[];
  budgetRaw: bigint;
}) {
  return withTransaction(async (q) => {
    await q("select id from pfl_seasons where id=$1 for update", [
      input.seasonId,
    ]);
    const existing = await q(
      "select period from pfl_settlements where season_id=$1 and pool=$2 and period=$3",
      [input.seasonId, input.pool, input.period],
    );
    if (existing.length) return { alreadyAllocated: true };
    const [{ available }] = await q<{ available: string }>(
      `select (coalesce((select sum(c.token_raw) from pfl_conversions c join pfl_fee_allocations a on a.receipt_signature=c.receipt_signature where a.season_id=$1 and c.pool=$2 and c.status='verified'),0)-coalesce((select sum(amount_raw) from pfl_entitlements where season_id=$1 and pool=$2),0))::text available`,
      [input.seasonId, input.pool],
    );
    if (input.budgetRaw < 0n || input.budgetRaw > BigInt(available))
      throw Error("Insufficient verified, unallocated PFL");
    const shares = prizeShares(
      input.budgetRaw,
      input.rows,
      input.pool === "daily"
        ? DAILY_WEIGHTS
        : input.pool === "season"
          ? SEASON_WEIGHTS
          : [10000],
    );
    for (const [wallet, raw] of Object.entries(shares.awards)) {
      if (raw === 0n) continue;
      await q(
        "insert into pfl_entitlements(season_id,round_id,wallet,pool,period,amount_raw,status) values($1,$2,$3,$4,$5,$6,'pending')",
        [
          input.seasonId,
          input.roundId,
          wallet,
          input.pool,
          input.period,
          raw.toString(),
        ],
      );
    }
    await q(
      "insert into pfl_settlements(season_id,pool,period,budget_raw,retained_raw,input_hash) values($1,$2,$3,$4,$5,$6)",
      [
        input.seasonId,
        input.pool,
        input.period,
        input.budgetRaw.toString(),
        shares.remainder.toString(),
        hash({ rows: input.rows, budget: input.budgetRaw.toString() }),
      ],
    );
    return { alreadyAllocated: false, remainder: shares.remainder.toString() };
  });
}

/** Prepare pending entitlements only. This never signs swaps or activates claims. */
export async function prepareRewards(season: Season) {
  const periods = await queryRows<{
    round_id: string;
    day: number;
    starts_at: string;
    ends_at: string;
  }>(
    `select d.round_id,d.day,d.starts_at,d.ends_at from pfl_days d join pfl_rounds r on r.id=d.round_id where r.season_id=$1 order by d.ends_at`,
    [season.id],
  );
  async function budget(pool: string, start: string, end: string) {
    const [result] = await queryRows<{ missing: string; raw: string }>(
      `select count(*) filter(where c.signature is null or c.status<>'verified' or c.sol_raw<>(case $2 when 'daily' then a.daily_raw when 'season' then a.season_raw else a.champion_raw end))::text missing,coalesce(sum(c.token_raw) filter(where c.status='verified'),0)::text raw from pfl_fee_allocations a join pf_creator_fee_receipts f on f.signature=a.receipt_signature left join pfl_conversions c on c.receipt_signature=a.receipt_signature and c.pool=$2 where a.season_id=$1 and f.collected_at >= $3 and f.collected_at < $4 and (case $2 when 'daily' then a.daily_raw when 'season' then a.season_raw else a.champion_raw end)>0`,
      [season.id, pool, start, end],
    );
    return Number(result.missing) === 0 ? BigInt(result.raw) : 0n;
  }
  for (const d of periods) {
    const raw = await budget("daily", d.starts_at, d.ends_at);
    if (raw === 0n) continue;
    const pendingCoverage = await queryRows(
      `select r.wallet from pfl_rosters r left join pfl_coverage c using(round_id,wallet) where r.round_id=$1 and r.disqualified_at is null and (c.through_at is null or c.through_at<$2)`,
      [d.round_id, d.ends_at],
    );
    if (pendingCoverage.length) continue;
    const rows = await queryRows<Standing>(
      `select s.wallet,s.points2 from pfl_scores s join pfl_rosters r using(round_id,wallet) where s.round_id=$1 and s.day=$2 and r.disqualified_at is null`,
      [d.round_id, d.day],
    );
    if (rows.length)
      await createEntitlements({
        seasonId: season.id,
        roundId: d.round_id,
        pool: "daily",
        period: `${d.round_id}:${d.day}`,
        rows,
        budgetRaw: raw,
      });
  }
  if (season.status !== "complete") return;
  const totals = await queryRows<{
    wallet: string;
    points: string;
    fantasy: string;
    best: number;
  }>(
    `select w.wallet,sum(w.season_points_bps)::text points,sum(w.points2)::text fantasy,min(w.rank) best from pfl_weekly_standings w join pfl_rounds r on r.id=w.round_id where r.season_id=$1 group by w.wallet`,
    [season.id],
  );
  const eligible = [];
  for (const r of totals) {
    const b = await getHolderBalance(r.wallet);
    if (eligibleBalance(b.rawBalance, b.decimals))
      eligible.push({
        wallet: r.wallet,
        points: Number(r.points),
        fantasyPoints2: Number(r.fantasy),
        bestRank: r.best,
      });
  }
  const ranked = rankSeason(eligible).map((r) => ({
    wallet: r.wallet,
    points2: -r.rank,
  }));
  if (!ranked.length) return;
  for (const pool of ["season", "champion"] as const) {
    const raw = await budget(
      pool,
      new Date(Date.parse(season.starts_at) - 2 * 86400000).toISOString(),
      season.ends_at,
    );
    if (raw > 0n)
      await createEntitlements({
        seasonId: season.id,
        roundId: null,
        pool,
        period: season.id,
        rows: ranked,
        budgetRaw: raw,
      });
  }
}
