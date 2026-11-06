// Disposable PostgreSQL + actual Token payment/signature/receipt code. RPC is fully offline.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import pg from 'pg';
import { getAddressDecoder } from '@solana/kit';
const base=new URL('../lib/server/',import.meta.url).href;
registerHooks({resolve(s,c,next){
 if(c.parentURL===base+'league/claims.ts'&&s==='../payout-signer')return {url:'data:text/javascript,export const signPayout=(...args)=>globalThis.claimFixture.sign(...args)',shortCircuit:true};
 if(['../solana','./solana'].includes(s)&&String(c.parentURL).startsWith(base))
  return {url:'data:text/javascript,export const rpc=(...args)=>globalThis.claimFixture.rpc(...args);export const verifyMainnetRpc=async()=>{};export const getNativeSolBalance=async()=>globalThis.claimFixture.native;export const verifyNativeSolTransfer=async()=>null;',shortCircuit:true};
 if(s==='server-only')return {url:'data:text/javascript,export {}',shortCircuit:true};
 if(s==='next/server')return next('next/server.js',c);
 if(s.startsWith('.')&&!/\.[a-z]+$/.test(s)&&existsSync(new URL(s+'.ts',c.parentURL)))return next(s+'.ts',c);
 return next(s,c);
}});
const {signPayoutTransaction,readPayoutSigner}=await import('../lib/server/payout-signing.ts');
const {claimEntitlement,processLeagueClaims}=await import('../lib/server/league/claims.ts');
const {tokenPaymentInstructions}=await import('../lib/server/token-payment.ts');
const {closeDatabasePool}=await import('../lib/server/database.ts');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const material=JSON.stringify([...privateKey.export({format:'der',type:'pkcs8'}).subarray(-32),...publicKey.export({format:'der',type:'spki'}).subarray(-32)]);
const signer=await readPayoutSigner(material);
const source=signer.address,winner=getAddressDecoder().decode(generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).subarray(-32));
const PUMP='pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn',TOKEN='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const mintFixture=JSON.parse(await readFile(new URL('./fixtures/pump-mint-mainnet.json',import.meta.url),'utf8'));
const name=`pf_fee_test_claims_${process.pid}`;
const admin=new pg.Client({connectionString:'postgresql://wgmifr@localhost:55442/postgres'});
let db;
const absentSignatures=new Set();
let signCount=0,sendCount=0,finalized=false,failed=false,badDelta=false,badWire=false,height=100;
const envKeys=['DATABASE_URL','PF_AUTO_PAYOUT_ENABLED','PF_LEAGUE_WORKER_ENABLED','PF_PAYOUT_NETWORK','PF_REWARD_ASSET','PF_AUTO_PAYOUT_MAX_AWARD_RAW','PF_AUTO_PAYOUT_MAX_SEASON_RAW','PF_AUTO_PAYOUT_RUN_UNTIL','PF_PAYOUT_SIGNER_KEYPAIR_JSON','PF_PRIZE_WALLET_ADDRESS','PF_CREATOR_WALLET_ADDRESS'];
assert.equal(Object.hasOwn(process.env,'PF_PAYOUT_SIGNER_KEYPAIR_JSON'),false,'Run without real signer secrets.');
assert.equal(Object.hasOwn(process.env,'DATABASE_URL'),false,'Harness creates its own disposable local database.');
const old=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
Object.assign(process.env,{DATABASE_URL:`postgresql://wgmifr@localhost:55442/${name}`,PF_AUTO_PAYOUT_ENABLED:'true',PF_LEAGUE_WORKER_ENABLED:'true',PF_PAYOUT_NETWORK:'mainnet-beta',PF_REWARD_ASSET:'PUMP',PF_AUTO_PAYOUT_MAX_AWARD_RAW:'25000',PF_AUTO_PAYOUT_MAX_SEASON_RAW:'50000',PF_AUTO_PAYOUT_RUN_UNTIL:new Date(Date.now()+60000).toISOString(),PF_PAYOUT_SIGNER_KEYPAIR_JSON:'offline-fixture-only',PF_PRIZE_WALLET_ADDRESS:source,PF_CREATOR_WALLET_ADDRESS:source});
const season={id:'claims',mint:winner,reward_mint:PUMP};
async function current(){return (await db.query('select c.*,e.wallet from pfl_claims c join pfl_entitlements e on e.id=c.entitlement_id order by c.created_at desc limit 1')).rows[0];}
async function receipt(c){
 const [,ix]=await tokenPaymentInstructions(c.source_wallet,c.wallet,c.amount_raw,'PUMP');
 const from=ix.accounts[0].address,to=ix.accounts[2].address;
 const balance=(accountIndex,owner,amount)=>({accountIndex,mint:PUMP,owner,uiTokenAmount:{amount,decimals:6}});
 return {slot:123,blockTime:456,meta:{err:null,preTokenBalances:[balance(1,source,'1000000')],postTokenBalances:[balance(1,source,String(1000000n-BigInt(c.amount_raw))),balance(2,c.wallet,badDelta?'1':c.amount_raw)]},transaction:{message:{accountKeys:[{pubkey:source,signer:true},{pubkey:from},{pubkey:to}],instructions:[{programId:TOKEN,parsed:{type:'transferChecked',info:{source:from,destination:to,authority:source,mint:PUMP,tokenAmount:{amount:c.amount_raw,decimals:6}}}}]}}};
}
globalThis.claimFixture={native:10000000n,tokens:1000000n,sign:async(unsigned,wallet)=>{assert.equal(wallet,source);signCount++;return signPayoutTransaction(unsigned,signer);},rpc:async(method,params)=>{
 switch(method){
 case 'getAccountInfo':{
  if(params[0]===PUMP)return {value:mintFixture};
  const info=params[0]===PUMP?{decimals:6,isInitialized:true}:{mint:PUMP,owner:source,state:'initialized',tokenAmount:{amount:String(globalThis.claimFixture.tokens),decimals:6}};
  return {value:{owner:TOKEN,data:{parsed:{info}}}};
 }
 case 'getLatestBlockhash':return {value:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:200}};
 case 'getFeeForMessage':return {value:5000};
 case 'getMinimumBalanceForRentExemption':return 2039280;
 case 'simulateTransaction':return {value:{err:null}};
 case 'getSignatureStatuses':return {value:[absentSignatures.has(params[0][0])?null:finalized?{confirmationStatus:'finalized',err:failed?{InstructionError:[1,'fixture']}:null}:null]};
 case 'getBlockHeight':return height;
 case 'getTransaction':{
  const c=await current();
  if(params[1].encoding==='base64')return {slot:123,meta:{err:null},transaction:[badWire?'AQ==':c.transaction_base64,'base64']};
  return receipt(c);
 }
 case 'sendTransaction':{
  const c=await current();assert.ok(c,'signed wire persisted before broadcast');assert.equal(params[0],c.transaction_base64);sendCount++;return c.signature;
 }
 default:throw Error(`Unexpected offline RPC method ${method}`);
 }
}};
async function entitlement(period,amount='20000',owner=winner,status='available'){
 return (await db.query('insert into pfl_entitlements(season_id,wallet,pool,period,amount_raw,status) values($1,$2,\'daily\',$3,$4,$5) returning id',[season.id,owner,period,amount,status])).rows[0].id;
}
async function rejects(id,pattern){await assert.rejects(claimEntitlement(id,winner),pattern);}
try{
 await admin.connect();await admin.query(`create database ${name}`);
 db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 for(const file of (await readdir('db/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.query(await readFile(`db/migrations/${file}`,'utf8'));
 await db.query("insert into pfl_seasons(id,title,number,mint,starts_at,ends_at,weeks,reward_mint) values('claims','Claims',999,$1,now(),now()+interval '28 days',4,$2)",[winner,PUMP]);
 await db.query("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status,reward_asset) values('funding',$1,$2,'offline',1,'finalized','PUMP')",[winner,source]);
 await db.query("insert into pf_creator_fee_receipts(signature,mint_address,gross_raw,daily_raw,season_raw,reserve_raw,reward_asset) values('funding',$1,1000000,300000,500000,200000,'PUMP')",[winner]);
 await db.query("insert into pfl_fee_allocations(receipt_signature,season_id,daily_raw,season_raw,champion_raw,reward_asset) values('funding','claims',300000,500000,200000,'PUMP')");
 const wrong=await entitlement('wrong','1',source);await rejects(wrong,/owner/);assert.equal(signCount,0);
 const cap=await entitlement('cap','25001');await rejects(cap,/award cap/);assert.equal(signCount,0);
 const pending=await entitlement('pending','1',winner,'pending');await rejects(pending,/unavailable/);
 // Simulate the exact historical pre-006 incomplete claim shape before modern binding triggers.
 await db.query("insert into pfl_seasons(id,title,number,mint,starts_at,ends_at,weeks,reward_mint) values('historical','Historical',1001,$1,now(),now()+interval '28 days',4,null)",[winner]);
 const oldId=(await db.query("insert into pfl_entitlements(season_id,wallet,pool,period,amount_raw,status) values('historical',$1,'daily','old',1,'available') returning id",[winner])).rows[0].id;
 await db.query('alter table pfl_claims disable trigger pfl_claim_binding');
 await db.query("insert into pfl_claims(entitlement_id,status,created_at) values($1,'prepared',now()-interval '1 day')",[oldId]);
 await db.query('alter table pfl_claims enable trigger pfl_claim_binding');
 assert.equal((await processLeagueClaims(season)).action,'no-pending-claims');
 const id=await entitlement('pay');
 globalThis.claimFixture.tokens=999999n;await rejects(id,/all receipt liabilities/);assert.equal(signCount,0);
 globalThis.claimFixture.tokens=1000000n;
 await db.query("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status,reward_asset) values('sol-reserve',$1,$2,'offline',1,'finalized','SOL')",[winner,source]);
 await db.query("insert into pf_creator_fee_receipts(signature,mint_address,gross_raw,daily_raw,season_raw,reserve_raw,reward_asset) values('sol-reserve',$1,1000000,300000,500000,200000,'SOL')",[winner]);
 await db.query("insert into pfl_fee_allocations(receipt_signature,season_id,daily_raw,season_raw,champion_raw,reward_asset) values('sol-reserve','historical',300000,500000,200000,'SOL')");
 globalThis.claimFixture.native=3000000n;await rejects(id,/SOL treasury/);assert.equal(signCount,0,'Unconverted historical PFL SOL allocations remain reserved');
 globalThis.claimFixture.native=10000000n;
 assert.equal((await claimEntitlement(id,winner)).action,'claim-submitted');assert.equal(signCount,1);assert.equal(sendCount,1);
 await claimEntitlement(id,winner);assert.equal(signCount,1,'replay never signs again');assert.equal(sendCount,2);
 process.env.PF_AUTO_PAYOUT_ENABLED='false';
 assert.equal((await processLeagueClaims(season)).action,'claim-awaiting-approved-run');assert.equal(sendCount,2,'OFF must not rebroadcast signed claims');
 process.env.PF_AUTO_PAYOUT_ENABLED='true';
 process.env.PF_AUTO_PAYOUT_RUN_UNTIL='2000-01-01T00:00:00Z';
 assert.equal((await processLeagueClaims(season)).action,'claim-awaiting-approved-run');assert.equal(sendCount,2);
 height=201;assert.equal((await processLeagueClaims(season)).action,'claim-unknown');assert.equal((await current()).status,'unknown');assert.equal(signCount,1);
 process.env.PF_AUTO_PAYOUT_ENABLED='false';finalized=true;badWire=true;
 await assert.rejects(processLeagueClaims(season),/Finalized bytes/);assert.equal((await current()).status,'unknown');
 badWire=false;badDelta=true;await assert.rejects(processLeagueClaims(season),/receipt does not match/);assert.equal((await current()).status,'unknown');
 await db.query("update pfl_entitlements set status='forfeited' where id=$1",[id]);
 badDelta=false;assert.equal((await processLeagueClaims(season)).action,'claim-confirmed');
 assert.equal((await db.query('select status from pfl_entitlements where id=$1',[id])).rows[0].status,'claimed');assert.equal(signCount,1);
 assert.equal((await claimEntitlement(id,winner)).action,'claim-confirmed');assert.equal(sendCount,2);
 process.env.PF_AUTO_PAYOUT_ENABLED='true';process.env.PF_AUTO_PAYOUT_RUN_UNTIL=new Date(Date.now()+60000).toISOString();finalized=false;height=100;
 const second=await entitlement('second');assert.equal((await claimEntitlement(second,winner)).action,'claim-submitted');
 finalized=true;failed=true;assert.equal((await processLeagueClaims(season)).action,'claim-failed');
 const third=await entitlement('third','11000');await rejects(third,/season cap/);assert.equal(signCount,2,'failed signed claim remains cap reserved');
 await db.query("insert into pfl_seasons(id,title,number,mint,starts_at,ends_at,weeks,reward_mint) values('legacy','Legacy',1000,$1,now(),now()+interval '28 days',4,null)",[winner]);
 const legacy=(await db.query("insert into pfl_entitlements(season_id,wallet,pool,period,amount_raw,status) values('legacy',$1,'daily','legacy',1,'available') returning id",[winner])).rows[0].id;
 assert.equal((await claimEntitlement(legacy,winner)).action,'claims-disabled');assert.equal(signCount,2);
 // An old expired unknown payment must not starve later finalized receipts.
 process.env.PF_AUTO_PAYOUT_MAX_SEASON_RAW='100000';
 finalized=false;failed=false;height=100;
 const uncertain=await entitlement('uncertain','1000');
 await claimEntitlement(uncertain,winner);
 const oldWire=await current();absentSignatures.add(oldWire.signature);
 height=201;assert.equal((await processLeagueClaims(season)).action,'claim-unknown');
 height=100;const later=await entitlement('later','1000');
 await claimEntitlement(later,winner);
 finalized=true;
 assert.equal((await processLeagueClaims(season)).action,'claim-confirmed');
 assert.equal((await db.query('select status from pfl_claims where entitlement_id=$1',[later])).rows[0].status,'confirmed');
 assert.equal((await db.query('select status from pfl_claims where entitlement_id=$1',[uncertain])).rows[0].status,'unknown');
 process.stdout.write('PASS: real PG claims bind owner/assets, preserve receipt funding, enforce caps, persist before send, replay one wire, unknown/expired recovery, finalized exact bytes + actual PUMP delta, OFF reconciliation, atomic entitlement claim and signed-failure reservations.\n');
}finally{
 await closeDatabasePool();if(db)await db.end();
 for(const k of envKeys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
 await admin.query(`drop database if exists ${name}`);await admin.end();
 delete globalThis.claimFixture;
}
