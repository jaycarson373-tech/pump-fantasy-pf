import "server-only";
import { randomUUID } from "node:crypto";
import { getActiveSeasonId, withTransaction } from "./database";
import { fetchPumpLeaderboard, type FantasyPlayer } from "./pumpfun";
import { saveRosterSnapshot } from "./players";
import { isWalletTestSeason, seasonWindowFromOpen } from "./season-window";
import archive from "../../data/pumpfun-one-month-top50.json";

async function testRoster() {
  try { return await fetchPumpLeaderboard(50, { fresh: true }); }
  catch {
    // This historical field is permitted only in the explicitly unfunded test.
    const players: FantasyPlayer[] = archive.players.map(([rank, wallet, name, pnl, avatar]) => ({
      id: `rank-${rank}`, rank: Number(rank), wallet: String(wallet), display_name: String(name),
      pnl_usd: Number(pnl), avatar_url: String(avatar), profile_url: `https://pump.fun/profile/${wallet}`,
    }));
    return { players, snapshotAt: archive.snapshotAt };
  }
}

/** Caller holds the season-start advisory lock; no reward work runs for test IDs. */
export async function openTestDraft() {
  const previous = await getActiveSeasonId();
  if (!previous) throw new Error("Configure a real season before opening a test draft.");
  if (isWalletTestSeason(previous)) throw new Error("A test draft already exists. Close it before opening another.");
  const board = await testRoster();
  const id = `wallet-test-${randomUUID()}`;
  const window = seasonWindowFromOpen(Date.now());
  await withTransaction(async query => {
    const seasons = await query<{ status: string }>("select status from pf_seasons where id=$1 for update", [previous]);
    if (seasons[0]?.status !== "draft") throw new Error("A test draft requires the real season to be closed in draft status.");
    await query("insert into pf_seasons(id,title,status,opens_at,locked_at,closes_at,daily_prize_lamports,prize_mode) values($1,'Wallet test','open',$2,$3,$4,0,'fixed')", [id,window.opensAt,window.lockedAt,window.closesAt]);
    await saveRosterSnapshot(id,board.players,new Date(board.snapshotAt),query);
    await query("insert into pf_app_config(key,value) values('wallet_test_previous_season_id',$1) on conflict(key) do update set value=excluded.value",[previous]);
    await query("update pf_app_config set value=$1,updated_at=now() where key='active_season_id'",[id]);
  });
  return { ok: true, seasonId: id, mode: "wallet-test", ...window };
}

export async function closeTestDraft() {
  return withTransaction(async query => {
    const config = await query<{key:string;value:string}>("select key,value from pf_app_config where key in ('active_season_id','wallet_test_previous_season_id') for update");
    const id = config.find(row=>row.key==='active_season_id')?.value;
    const previous = config.find(row=>row.key==='wallet_test_previous_season_id')?.value;
    if (!id || !isWalletTestSeason(id) || !previous || isWalletTestSeason(previous)) throw new Error("No restorable test draft is active. Inspect the active season before retrying.");
    const season = await query<{id:string}>("select id from pf_seasons where id=$1 and status='draft' for update",[previous]);
    if (!season.length) throw new Error("The real season changed. Restore its draft status before closing this test.");
    await query("update pf_seasons set status='complete' where id=$1",[id]);
    await query("update pf_app_config set value=$1,updated_at=now() where key='active_season_id'",[previous]);
    await query("delete from pf_app_config where key='wallet_test_previous_season_id'");
    return { ok:true, closedTestSeasonId:id, seasonId:previous, mode:"holders" };
  });
}
