// Actual isolated PostgreSQL migration/payment boundaries. No network or signing.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { registerHooks } from 'node:module';
const serverSource=new URL('../lib/server/',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(context.parentURL?.startsWith(serverSource)&&specifier.startsWith('.')&&!/\.[a-z]+$/.test(specifier)?`${specifier}.ts`:specifier,context);}});
const {getFeeTreasury}=await import('../lib/server/fee-treasury.ts');
const {closeDatabasePool}=await import('../lib/server/database.ts');
const url = new URL(process.env.DATABASE_URL);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname.startsWith('/pf_fee_test'), 'Use a fresh local pf_fee_test database.');
const db = new pg.Client({ connectionString:url.href });
const PUMP = 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';
async function reject(sql, args=[]) { await assert.rejects(db.query(sql,args)); }
async function season(id, mint) { await db.query("insert into pfl_seasons(id,title,number,mint,starts_at,ends_at,weeks,reward_mint) values($1,$1,$2,'base',now(),now()+interval '28 days',4,$3)", [id,id==='old'?1:2,mint]); }
async function receipt(id, asset) {
 await db.query("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status,reward_asset) values($1,'base','fixture','unsigned',1,'finalized',$2)",[id,asset]);
 await db.query("insert into pf_creator_fee_receipts(signature,mint_address,gross_raw,daily_raw,season_raw,reserve_raw,reward_asset) values($1,'base',100,30,50,20,$2)",[id,asset]);
}
try {
 await db.connect();
 assert.equal((await db.query("select to_regclass('pf_seasons') present")).rows[0].present,null);
 const files=(await readdir('db/migrations')).filter(x=>x.endsWith('.sql')).sort();
 for (const file of files.filter(x=>x<'202611060005')) await db.query(await readFile(`db/migrations/${file}`,'utf8'));
 // Historical PFL rows are already bound to their original base token before upgrade.
 await db.query("insert into pfl_seasons(id,title,number,mint,starts_at,ends_at,weeks) values('old','Old',1,'base',now(),now()+interval '28 days',4)");
 await db.query("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status) values('pre-upgrade','base','fixture','unsigned',1,'finalized')");
 await db.query("insert into pf_creator_fee_receipts(signature,mint_address,gross_lamports,daily_lamports,season_lamports,reserve_lamports) values('pre-upgrade','base',100,30,50,20)");
 await db.query("insert into pfl_fee_allocations(receipt_signature,season_id,daily_raw,season_raw,champion_raw) values('pre-upgrade','old',30,50,20)");
 const oldId=(await db.query("insert into pfl_entitlements(season_id,wallet,pool,period,amount_raw) values('old','old-wallet','daily','old',10) returning id")).rows[0].id;
 await db.query("insert into pfl_claims(entitlement_id,status) values($1,'prepared')",[oldId]);
 for (const file of files.filter(x=>x>='202611060005')) await db.query(await readFile(`db/migrations/${file}`,'utf8'));
 assert.equal((await db.query("select reward_asset from pfl_fee_allocations where receipt_signature='pre-upgrade'")).rows[0].reward_asset,'SOL');
 assert.equal((await db.query("select competition_format from pf_creator_fee_receipts where signature='pre-upgrade'")).rows[0].competition_format,'starting-seven-v1');
 assert.equal((await db.query("select reward_mint from pfl_seasons where id='old'")).rows[0].reward_mint,null);
 assert.equal((await db.query('select reward_mint from pfl_entitlements where id=$1',[oldId])).rows[0].reward_mint,'base');
 await reject("update pfl_entitlements set reward_mint=$1 where id=$2",[PUMP,oldId]);
 await season('new',PUMP);
 await receipt('SOL','SOL'); await receipt('PUMP','PUMP'); await receipt('mismatch','SOL');
 await db.query("insert into pfl_fee_allocations(receipt_signature,season_id,daily_raw,season_raw,champion_raw,reward_asset) values('SOL','old',30,50,20,'SOL')");
 await reject("insert into pfl_fee_allocations(receipt_signature,season_id,daily_raw,season_raw,champion_raw,reward_asset) values('mismatch','new',30,50,20,'PUMP')");
 await reject("insert into pfl_fee_allocations(receipt_signature,season_id,daily_raw,season_raw,champion_raw,reward_asset) values('PUMP','new',31,49,20,'PUMP')");
 const allocate="insert into pfl_fee_allocations(receipt_signature,season_id,daily_raw,season_raw,champion_raw,reward_asset) values('PUMP','new',30,50,20,'PUMP')";
 const peer=new pg.Client({connectionString:url.href});await peer.connect();
 try { const results=await Promise.allSettled([db.query(allocate),peer.query(allocate)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1); }
 finally {await peer.end();}
 await reject(allocate);
 assert.equal((await getFeeTreasury('base','PUMP')).gross,0n,'Starting Seven receipts cannot inflate legacy treasury');
 assert.equal((await getFeeTreasury('base','SOL')).gross,100n,'Only the unmatched legacy SOL receipt remains legacy');
 await reject("update pf_creator_fee_receipts set competition_format='legacy' where signature='PUMP'");
 await reject("update pfl_seasons set reward_mint=null where id='new'");
 await reject("update pfl_seasons set mint='other' where id='new'");
 await reject("insert into pfl_conversions(signature,receipt_signature,pool,sol_raw,token_raw,mint,status) values('bad','PUMP','daily',30,30,'base','pending')");
 await db.query("insert into pfl_conversions(signature,receipt_signature,pool,sol_raw,token_raw,mint,status,confirmed_slot) values('historical','SOL','daily',30,300,'base','verified',123)");
 const id=(await db.query("insert into pfl_entitlements(season_id,wallet,pool,period,amount_raw,status) values('new','winner','daily','period',30,'available') returning id,reward_mint")).rows[0];
 assert.equal(id.reward_mint,PUMP);
 await reject("update pfl_entitlements set amount_raw=31 where id=$1",[id.id]);
 await reject("update pfl_entitlements set wallet='other' where id=$1",[id.id]);
 await reject("insert into pfl_claims(entitlement_id,status) values($1,'prepared')",[id.id]);
 const args=[id.id,'fixture-signature','fixture-wire','fixture-blockhash','fixture-source',30,PUMP];
 const claim="insert into pfl_claims(entitlement_id,status,signature,transaction_base64,blockhash,last_valid_block_height,source_wallet,amount_raw,mint,prepared_at) values($1,'prepared',$2,$3,$4,123,$5,$6,$7,now())";
 await reject(claim,[...args.slice(0,6),'base']);
 await db.query(claim,args);
 await reject(claim,args);
 await reject("update pfl_claims set transaction_base64='replacement' where entitlement_id=$1",[id.id]);
 await reject("update pfl_claims set mint='base' where entitlement_id=$1",[id.id]);
 await db.query("update pfl_claims set status='unknown' where entitlement_id=$1",[id.id]);
 await reject("update pfl_claims set status='prepared' where entitlement_id=$1",[id.id]);
 await reject("update pfl_claims set status='confirmed' where entitlement_id=$1",[id.id]);
 await db.query("update pfl_claims set status='confirmed',confirmed_slot=456 where entitlement_id=$1",[id.id]);
 await reject("delete from pfl_claims where entitlement_id=$1",[id.id]);
 await reject("delete from pfl_entitlements where id=$1",[id.id]);
 await reject("update pfl_claims set status='failed' where entitlement_id=$1",[id.id]);
 process.stdout.write('PASS: PFL legacy mint preservation, direct PUMP allocation, per-pool conservation, concurrency/replay, immutable season/entitlement/claim identity, complete signed binding and confirmation boundaries.\n');
} finally {await closeDatabasePool();await db.end();}
