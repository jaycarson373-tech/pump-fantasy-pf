import "server-only";
import type { RewardAsset } from "../reward-asset";
import { queryRows, type RowsQuery } from "./database";

export async function getAwardFeeAllocation(awardId: string, mint: string, kind: "daily" | "season", asset: RewardAsset = "SOL") {
  const rows = await queryRows<{ amount: string }>("select coalesce(sum(case when $3='daily' then daily_raw else season_raw end),0)::text as amount from pf_creator_fee_receipts where competition_format='legacy' and mint_address=$2 and reward_asset=$4 and (($3='daily' and award_id=$1) or ($3='season' and season_award_id=$1))", [awardId, mint, kind, asset]);
  return BigInt(rows[0].amount);
}

/** Legacy totals remain isolated; leagueSolReserved separately protects unconverted SOL. */
export async function getFeeTreasury(mint: string, asset: RewardAsset = "SOL", query: RowsQuery = queryRows) {
  const rows = await query<{ gross: string; daily: string; season: string; reserve: string; available: string; season_available: string; paid: string; league_sol_reserved: string }>(`select
    coalesce(sum(gross_raw),0)::text as gross,
    coalesce(sum(daily_raw),0)::text as daily,
    coalesce(sum(season_raw),0)::text as season,
    coalesce(sum(reserve_raw),0)::text as reserve,
    coalesce(sum(daily_raw) filter(where award_id is null),0)::text as available,
    coalesce(sum(season_raw) filter(where season_award_id is null),0)::text as season_available,
    (coalesce(sum(daily_raw) filter(where award_id in (select id from pf_daily_awards where status='paid')),0)
      + coalesce(sum(season_raw) filter(where season_award_id in (select id from pf_daily_awards where status='paid')),0))::text as paid,
    (coalesce((select sum(a.daily_raw+a.season_raw+a.champion_raw)
      from pfl_fee_allocations a join pf_creator_fee_receipts r on r.signature=a.receipt_signature
      where r.mint_address=$1 and a.reward_asset='SOL'),0)
      - coalesce((select sum(c.sol_raw) from pfl_conversions c
      join pfl_fee_allocations a on a.receipt_signature=c.receipt_signature
      join pf_creator_fee_receipts r on r.signature=a.receipt_signature
      where r.mint_address=$1 and a.reward_asset='SOL' and c.status='verified'),0))::text as league_sol_reserved
    from pf_creator_fee_receipts where competition_format='legacy' and mint_address=$1 and reward_asset=$2`, [mint, asset]);
  const row = rows[0];
  return { gross: BigInt(row.gross), daily: BigInt(row.daily), season: BigInt(row.season), reserve: BigInt(row.reserve), available: BigInt(row.available), seasonAvailable: BigInt(row.season_available), paid: BigInt(row.paid), leagueSolReserved: BigInt(row.league_sol_reserved) };
}
