// Actual PostgreSQL asset boundaries; no keys, RPC, or signing.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.startsWith('/pf_fee_test'), 'Use a new local pf_fee_test database.');
assert.ok(!Object.hasOwn(process.env, 'PF_PAYOUT_SIGNER_KEYPAIR_JSON'), 'Remove signer keys before testing.');
const serverSource = new URL('../lib/server/', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.startsWith(serverSource) && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context);
}});
const { getFeeTreasury, getAwardFeeAllocation } = await import('../lib/server/fee-treasury.ts');
const { closeDatabasePool } = await import('../lib/server/database.ts');
const db = new pg.Client({ connectionString: url.href });
async function claim(signature, asset) {
  await db.query("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status,reward_asset) values($1,'same-mint','fixture','unsigned',1,'finalized',$2)", [signature, asset]);
}
async function reject(sql, parameters = []) { await assert.rejects(db.query(sql, parameters)); }
try {
  await db.connect();
  assert.equal((await db.query("select to_regclass('pf_seasons') as present")).rows[0].present, null);
  const names = (await readdir('db/migrations')).filter(name => name.endsWith('.sql')).sort();
  for (const name of names.filter(name => name < '202611060001')) await db.query(await readFile(`db/migrations/${name}`, 'utf8'));
  await db.query("insert into pf_creator_claims values('legacy','same-mint','fixture','unsigned',1,'finalized',now())");
  await db.query("insert into pf_creator_fee_receipts(signature,mint_address,gross_lamports,daily_lamports,reserve_lamports) values('legacy','same-mint',100,65,35)");
  for (const name of names.filter(name => name >= '202611060001')) await db.query(await readFile(`db/migrations/${name}`, 'utf8'));
  const legacy = (await db.query("select daily_raw,season_raw,reserve_raw,reward_asset from pf_creator_fee_receipts where signature='legacy'")).rows[0];
  assert.deepEqual(legacy, { daily_raw:'65', season_raw:'0', reserve_raw:'35', reward_asset:'SOL' });
  for (const asset of ['SOL', 'PUMP']) {
    await db.query("insert into pf_seasons(id,title,status,mint_address,reward_asset) values($1,'fixture','open','same-mint',$1)", [asset]);
    await claim(asset, asset);
    await db.query("insert into pf_creator_fee_receipts(signature,mint_address,gross_raw,daily_raw,season_raw,reserve_raw,reward_asset) values($1,'same-mint',100,30,50,20,$1)", [asset]);
  }
  const award = (await db.query("insert into pf_daily_awards(season_id,award_kind,day_number,prize_raw,status,reward_asset) values('PUMP','season',null,50,'pending_payment','PUMP') returning id")).rows[0].id;
  await reject("update pf_creator_fee_receipts set season_award_id=$1 where signature='SOL'", [award]);
  await db.query("update pf_creator_fee_receipts set season_award_id=$1 where signature='PUMP'", [award]);
  assert.equal(await getAwardFeeAllocation(award, 'same-mint', 'season', 'PUMP'), 50n);
  assert.equal(await getAwardFeeAllocation(award, 'same-mint', 'season', 'SOL'), 0n);
  assert.equal((await getFeeTreasury('same-mint', 'PUMP')).gross, 100n);
  assert.equal((await getFeeTreasury('same-mint', 'SOL')).gross, 200n);
  await reject("update pf_creator_fee_receipts set award_id=$1 where signature='PUMP'", [award]);
  await reject("update pf_creator_fee_receipts set season_award_id=null where signature='PUMP'");
  await reject("update pf_creator_claims set reward_asset='PUMP' where signature='legacy'");
  await reject("update pf_creator_fee_receipts set reward_asset='SOL' where signature='PUMP'");
  await reject("update pf_seasons set reward_asset='SOL' where id='PUMP'");
  await reject("update pf_daily_awards set season_id='SOL',reward_asset='SOL' where id=$1", [award]);
  await reject("insert into pf_daily_awards(season_id,day_number,status,reward_asset) values('PUMP',1,'awaiting_data','SOL')");
  await claim('mismatch', 'PUMP');
  await reject("insert into pf_creator_fee_receipts(signature,mint_address,gross_raw,daily_raw,season_raw,reserve_raw,reward_asset) values('mismatch','same-mint',100,30,50,20,'SOL')");
  process.stdout.write('PASS: historical SOL preservation, raw rename, treasury isolation, allocation isolation and immutable cross-record asset bindings.\n');
} finally { await closeDatabasePool(); await db.end(); }
