import "server-only";
import { queryRows, type RowsQuery } from "./database";

export async function getFeeTreasury(mint: string, query: RowsQuery = queryRows) {
  const rows = await query<{ gross: string; daily: string; reserve: string; available: string; paid: string }>(`select
    coalesce(sum(gross_lamports),0)::text as gross,
    coalesce(sum(daily_lamports),0)::text as daily,
    coalesce(sum(reserve_lamports),0)::text as reserve,
    coalesce(sum(daily_lamports) filter(where award_id is null),0)::text as available,
    coalesce(sum(daily_lamports) filter(where award_id in (select id from pf_daily_awards where status='paid')),0)::text as paid
    from pf_creator_fee_receipts where mint_address=$1`, [mint]);
  const row = rows[0];
  return { gross: BigInt(row?.gross ?? 0), daily: BigInt(row?.daily ?? 0), reserve: BigInt(row?.reserve ?? 0), available: BigInt(row?.available ?? 0), paid: BigInt(row?.paid ?? 0) };
}
