import "server-only";
import { queryRows, type RowsQuery } from "./database";

export async function getAwardFeeAllocation(awardId: string, mint: string, kind: "daily" | "season") {
  const rows = await queryRows<{ amount: string }>("select coalesce(sum(case when $3='daily' then daily_lamports else season_lamports end),0)::text as amount from pf_creator_fee_receipts where mint_address=$2 and (($3='daily' and award_id=$1) or ($3='season' and season_award_id=$1))", [awardId, mint, kind]);
  return BigInt(rows[0].amount);
}

export async function getFeeTreasury(mint: string, query: RowsQuery = queryRows) {
  const rows = await query<{ gross: string; daily: string; season: string; reserve: string; available: string; season_available: string; paid: string }>(`select
    coalesce(sum(gross_lamports),0)::text as gross,
    coalesce(sum(daily_lamports),0)::text as daily,
    coalesce(sum(season_lamports),0)::text as season,
    coalesce(sum(reserve_lamports),0)::text as reserve,
    coalesce(sum(daily_lamports) filter(where award_id is null),0)::text as available,
    coalesce(sum(season_lamports) filter(where season_award_id is null),0)::text as season_available,
    (coalesce(sum(daily_lamports) filter(where award_id in (select id from pf_daily_awards where status='paid')),0)
      + coalesce(sum(season_lamports) filter(where season_award_id in (select id from pf_daily_awards where status='paid')),0))::text as paid
    from pf_creator_fee_receipts where mint_address=$1`, [mint]);
  const row = rows[0];
  return { gross: BigInt(row.gross), daily: BigInt(row.daily), season: BigInt(row.season), reserve: BigInt(row.reserve), available: BigInt(row.available), seasonAvailable: BigInt(row.season_available), paid: BigInt(row.paid) };
}
