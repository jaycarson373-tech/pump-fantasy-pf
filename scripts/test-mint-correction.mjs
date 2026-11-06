import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&url.pathname.startsWith('/pf_mint_test'),'Use a disposable local pf_mint_test database.');
const oldMint='FntsyveWSihAySCYY9j3qr64LTE2FVM6JT3dbELpBhZo',newMint='FnTSYWv39UTMLaVPF3cKFKjamhGBadNs3NAmDZCFuEp5';
const sql=await readFile('db/migrations/202611060003_correct_prelaunch_mint.sql','utf8');
const db=new pg.Client({connectionString:url.href});
async function prepare(){
 await db.query('begin');
 await db.query("update pf_seasons set mint_address=$1,status='open',opens_at=now(),locked_at=now()+interval '1 hour',closes_at=now()+interval '49 hours' where id='season-1'",[oldMint]);
}
try{
 await db.connect();await prepare();
 const before=(await db.query("select opens_at,locked_at,closes_at from pf_seasons where id='season-1'")).rows[0];
 await db.query(sql);await db.query(sql);
 const after=(await db.query("select mint_address,opens_at,locked_at,closes_at from pf_seasons where id='season-1'")).rows[0];
 assert.equal(after.mint_address,newMint);delete after.mint_address;assert.deepEqual(after,before);await db.query('rollback');
 const guards=[
 "insert into pf_entries(season_id,wallet,picks,token_balance_raw) values('season-1','11111111111111111111111111111111','[\"a\",\"b\",\"c\",\"d\",\"e\"]',0)",
 "insert into pf_daily_awards(season_id,day_number,status,prize_lamports) values('season-1',1,'awaiting_data',0)",
 "insert into pf_score_snapshots(season_id,boundary,captured_at,source_url,pnl_by_wallet) values('season-1',0,now(),'local-fixture','{}')",
 "insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status) values('local-fixture','"+oldMint+"','11111111111111111111111111111111','fixture',1,'prepared')",
 "update pf_seasons set locked_at=now()-interval '1 second' where id='season-1'"
 ];
 for(const guard of guards){await prepare();await db.query(guard);await assert.rejects(db.query(sql),/Mint correction/);await db.query('rollback');}
 console.log('PASS: mint correction preserves schedule, is idempotent, and rejects entries, awards, scoring, old claims and closed draft.');
}finally{await db.query('rollback').catch(()=>{});await db.end();}
