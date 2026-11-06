// Run with Node 24 --conditions=react-server against a NEW disposable local database.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.pathname.startsWith('/pf_fee_test'), 'Use a disposable local pf_fee_test database.');
assert.ok(!Object.hasOwn(process.env,'PF_PAYOUT_SIGNER_KEYPAIR_JSON'), 'Run without a payout key in the environment.');
delete process.env.SOLANA_RPC_URL;
process.env.PF_AUTO_PAYOUT_ENABLED='false';
process.env.PF_FEE_COLLECTION_ENABLED='false';
const serverSource = new URL('../lib/server/',import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/server' || specifier === 'next/headers') return next(`${specifier}.js`, context);
  return next(context.parentURL?.startsWith(serverSource) && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context);
}});
const db = new pg.Client({ connectionString: url.href });
const { settleSeasonAward } = await import('../lib/server/season-award.ts');
const { getFeeTreasury, getAwardFeeAllocation } = await import('../lib/server/fee-treasury.ts');
const { closeDatabasePool } = await import('../lib/server/database.ts');
const { splitCreatorFees } = await import('../lib/server/fee-accounting.ts');
const { tickSeason } = await import('../lib/server/season-results.ts');
const walletA = '11111111111111111111111111111111';
const walletB = '22222222222222222222222222222222';
const cutoff = new Date(Date.now() - 60_000).toISOString();

async function claim(signature, mint) {
  await db.query("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status) values($1,$2,$3,'local-fixture',1,'finalized')", [signature,mint,walletA]);
}
async function receipt(signature, mint, at = cutoff) {
  await claim(signature,mint);
  const split=splitCreatorFees(1_000_000_000n);
  await db.query('insert into pf_creator_fee_receipts(signature,mint_address,gross_lamports,daily_lamports,season_lamports,reserve_lamports,collected_at) values($1,$2,$3,$4,$5,$6,$7)', [signature,mint,...['gross','daily','season','reserve'].map(key=>split[key].toString()),at]);
}
async function season(id, withEntries = true, withClosing = true) {
  await db.query("insert into pf_seasons(id,title,status,mint_address,prize_mode,closes_at) values($1,'Local fee test','open',$1,'creator-fees',$2)",[id,cutoff]);
  const players=Array.from({length:10},(_,index)=>({id:`${id}-${index}`,wallet:"123456789A"[index].repeat(32)}));
  for (const [index, player] of players.entries()) await db.query("insert into pf_players(id,season_id,rank,wallet,pnl_usd,source_url,snapshot_at) values($1,$2,$3,$4,0,'local-fixture',now())", [player.id,id,(index%5)*10+Math.floor(index/5)+1,player.wallet]);
  if (withEntries) for (const [index,wallet] of [walletA,walletB].entries()) await db.query('insert into pf_entries(season_id,wallet,picks,token_balance_raw) values($1,$2,$3,0)',[id,wallet,JSON.stringify(players.slice(index*5,index*5+5).map(p=>p.id))]);
  for (const boundary of withClosing ? [0,1,2] : [0,1]) {
    const values=Object.fromEntries(players.map((player,index)=>[player.wallet,boundary===0?0:([100,110][boundary-1]*(index<5?1:0)+[0,60][boundary-1]*(index>=5?1:0))]));
    await db.query("insert into pf_score_snapshots(season_id,boundary,captured_at,source_url,pnl_by_wallet) values($1,$2,now(),'local-fixture',$3)",[id,boundary,JSON.stringify(values)]);
  }
  return {id,mint_address:id,prize_mode:'creator-fees',closes_at:cutoff};
}
async function migrateFromLegacy() {
  const existing=await db.query("select to_regclass('public.pf_seasons') as present");
  assert.equal(existing.rows[0].present,null,'Use a new database; this test does not erase existing data.');
  await db.query('create table pf_schema_migrations(name text primary key,applied_at timestamptz default now())');
  const names=(await readdir('db/migrations')).filter(name=>name.endsWith('.sql')).sort();
  for (const name of names.filter(name=>name<'202611060001_season_fee_rewards.sql')) {
    await db.query(await readFile(`db/migrations/${name}`,'utf8'));
    await db.query('insert into pf_schema_migrations(name) values($1)',[name]);
  }
  await claim('legacy','legacy-mint');
  await db.query("insert into pf_creator_fee_receipts(signature,mint_address,gross_lamports,daily_lamports,reserve_lamports) values('legacy','legacy-mint',100,65,35)");
  execFileSync(process.execPath,['scripts/migrate.mjs'],{stdio:'pipe'});
  execFileSync(process.execPath,['scripts/migrate.mjs'],{stdio:'pipe'});
  const legacy=(await db.query("select daily_lamports,season_lamports,reserve_lamports,split_version from pf_creator_fee_receipts where signature='legacy'")).rows[0];
  assert.deepEqual(legacy,{daily_lamports:'65',season_lamports:'0',reserve_lamports:'35',split_version:1});
}
async function settlementChecks() {
  const s=await season('winner');
  await receipt('on-time',s.id);
  await receipt('late',s.id,new Date(Date.parse(cutoff)+1).toISOString());
  await receipt('different-mint','another-mint');
  await Promise.all([settleSeasonAward(s),settleSeasonAward(s)]);
  await settleSeasonAward(s);
  const awards=(await db.query("select * from pf_daily_awards where season_id=$1 and award_kind='season'",[s.id])).rows;
  assert.equal(awards.length,1,'Concurrent/replayed settlement awards once');
  const a=awards[0];
  assert.equal(a.winner_wallet,walletA,'Overall winner differs from day-two winner');
  assert.equal(Number(a.score_usd),550);assert.equal(a.prize_lamports,'500000000');
  assert.equal(a.status,'pending_payment');assert.equal(a.day_number,null);
  assert.equal(await getAwardFeeAllocation(a.id,s.id,'season'),500_000_000n);
  assert.equal(await getAwardFeeAllocation(a.id,s.id,'daily'),0n);
  assert.equal(await getAwardFeeAllocation(a.id,'another-mint','season'),0n);
  const daily=(await db.query("insert into pf_daily_awards(season_id,day_number,prize_lamports,status) values($1,1,300000000,'pending_payment') returning id",[s.id])).rows[0];
  await db.query("update pf_creator_fee_receipts set award_id=$1 where signature='on-time'",[daily.id]);
  assert.equal(await getAwardFeeAllocation(daily.id,s.id,'daily'),300_000_000n);
  await db.query("update pf_daily_awards set status='paid' where id=any($1::uuid[])",[[a.id,daily.id]]);
  const treasury=await getFeeTreasury(s.id);
  assert.equal(treasury.paid,800_000_000n);
  assert.equal(treasury.gross-treasury.paid,1_200_000_000n,'Remaining pools and championship reserves stay protected');
  assert.equal(treasury.reserve,400_000_000n);
  assert.equal(treasury.seasonAvailable,500_000_000n,'Post-cutoff receipt stays available');
  await assert.rejects(db.query("update pf_creator_fee_receipts set season_lamports=900000000 where signature='late'"),/constraint/);
}
async function holdAndCarryChecks() {
  const missing=await season('missing',true,false);
  await receipt('missing-data',missing.id);
  await settleSeasonAward(missing);
  assert.equal((await db.query("select status from pf_daily_awards where season_id='missing'")).rows[0].status,'awaiting_data');
  assert.equal((await getFeeTreasury(missing.id)).seasonAvailable,0n,'Missing data holds the season allocation');
  const empty=await season('empty',false);
  await receipt('no-entries',empty.id);
  await settleSeasonAward(empty);
  assert.equal((await db.query("select status from pf_daily_awards where season_id='empty'")).rows[0].status,'no_eligible_entries');
  assert.equal((await getFeeTreasury(empty.id)).seasonAvailable,500_000_000n);
  const future=await season('future');
  await settleSeasonAward({...future,closes_at:new Date(Date.now()+60_000).toISOString()});
  assert.equal((await db.query("select count(*)::int as n from pf_daily_awards where season_id='future'")).rows[0].n,0);
  await settleSeasonAward({...future,id:'wallet-test-12345678-1234-4234-8234-123456789012'});
  assert.equal((await db.query("select count(*)::int as n from pf_daily_awards where season_id like 'wallet-test-%'")).rows[0].n,0);
}
async function workerCheck() {
  const s=await season('worker');
  await receipt('worker-fees',s.id);
  await db.query("update pf_seasons set opens_at=closes_at-interval '49 hours',locked_at=closes_at-interval '48 hours' where id=$1",[s.id]);
  await db.query("update pf_app_config set value=$1 where key='active_season_id'",[s.id]);
  const realFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.equal(new URL(url).pathname,'/pnl-leaderboard','Only the draft cache may request an external snapshot in this fixture');
    return new Response('Unavailable',{status:403});
  };
  let tick;
  try { tick=await tickSeason(); }
  finally { globalThis.fetch=realFetch; }
  assert.equal(tick.value.payout.action,'payout-disabled');
  const awards=(await db.query('select award_kind,day_number,prize_lamports from pf_daily_awards where season_id=$1',[s.id])).rows;
  assert.equal(awards.length,3,'The real worker records two daily awards plus the season award');
  assert.equal(awards.find(a=>a.award_kind==='season').prize_lamports,'500000000');
  assert.equal((await getFeeTreasury(s.id)).paid,0n,'No signing or transfers run in this test');
}
try {
  await db.connect();
  await migrateFromLegacy();
  await settlementChecks();
  await holdAndCarryChecks();
  await workerCheck();
  process.stdout.write('PASS: legacy migration, 30/50/20 conservation, 48h winner, concurrency/replay, cutoff/mint isolation, independent allocations, paid accounting, reserves, missing data holds, empty carry, pre-close/test guards, real worker settlement with payouts disabled.\n');
} finally {
  await closeDatabasePool();
  await db.end();
}
