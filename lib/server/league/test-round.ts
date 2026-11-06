import "server-only";
import { isDeepStrictEqual } from "node:util";
import catalog from "../../../data/pumpfun-monthly-top100.json" with { type: "json" };
import { makeOpeningCalendar, validateRosterSelection } from "../../league/engine";
import { getBackendConfig } from "../config";
import { withTransaction } from "../database";
import { verifyTokenMint } from "../solana";
import { hash } from "./provider";

export const TEST_FORMAT = "starting-seven-test-v1";
export function validateTestRoster(pool: unknown, picks: string[], captain: string) {
  if (!isDeepStrictEqual(pool, catalog.players)) throw Error("Test roster must use the saved catalog unchanged");
  validateRosterSelection(catalog.players, picks, captain);
}

/** Explicit operator rehearsal; no ranking attestations, scoring or reward authority. */
export async function openTestRound(id: string) {
  if (!/^test-[a-zA-Z0-9_-]{1,55}$/.test(id)) throw Error("Use a unique test- prefixed round ID");
  const mint = getBackendConfig().mint;
  if (!mint) throw Error("Configure the test mint first");
  await verifyTokenMint(mint);
  return withTransaction(async (q) => {
    await q("select pg_advisory_xact_lock(hashtext('pfl-create-season'))");
    const [existing] = await q<{mint:string;format:string}>("select mint,format from pfl_seasons where id=$1", [id]);
    if (existing) {
      if (existing.mint !== mint || existing.format !== TEST_FORMAT) throw Error("Test ID already belongs to another mint or format");
      return {id, reused:true};
    }
    const active = await q("select id from pfl_seasons where status <> 'paused' and ends_at > now()");
    if (active.length) throw Error("An existing season must finish or be paused before opening a test round");
    const [time] = await q<{now:string}>("select clock_timestamp()::text as now");
    const [round] = makeOpeningCalendar(new Date(time.now).toISOString(), 1);
    const [number] = await q<{number:number}>("select coalesce(max(number),0)+1 as number from pfl_seasons");
    await q("insert into pfl_seasons(id,title,number,mint,starts_at,ends_at,weeks,status,format,reward_mint) values($1,'PFL Test Round',$2,$3,$4,$5,1,'active',$6,null)",
      [id,number.number,mint,round.locksAt,round.endsAt,TEST_FORMAT]);
    await q("insert into pfl_rounds(id,season_id,week,opens_at,locks_at,ends_at,status,pool,pool_hash,pool_source,pool_observed_at,methodology) values($1,$2,1,$3,$4,$5,'open',$6,$7,$8,$9,$10)",
      [`${id}-w1`,id,round.opensAt,round.locksAt,round.endsAt,JSON.stringify(catalog.players),hash(catalog.players),catalog.sourceUrl,catalog.capturedAt,"Saved catalog for entry testing only; no scoring or payouts"]);
    return {id, calendar:[round], reused:false};
  });
}
