import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {assetDetails} from '../lib/reward-asset.ts';
const PUMP=assetDetails('PUMP').mint;
const state={queries:[],verify:[],query:async()=>[]};
globalThis.__pflAccounting=state;
const modules={
 '../database':`export const queryRows=(...args)=>globalThis.__pflAccounting.query(...args);export const withTransaction=fn=>fn(queryRows);export const withAdvisoryLock=async(_key,fn)=>{globalThis.__pflAccounting.order.push("lock");try{return await fn()}finally{globalThis.__pflAccounting.order.push("unlock")}};`,
 './provider':`export const hash=()=>"offline-input-hash";export const provider=async()=>{throw Error('Unexpected provider call')};export const rankingsEvidence=provider;export const intervalEvidence=provider;`,
 '../solana':`export const verifyTokenMint=async mint=>{globalThis.__pflAccounting.verify.push(mint);return {decimals:9}};export const getHolderBalance=async()=>({rawBalance:'500000000000',decimals:6});`,
 '../reward-chain':`export const verifyRewardAsset=async asset=>{globalThis.__pflAccounting.verify.push(asset)};`,
 '../config':`export const getBackendConfig=()=>({mint:'base-mint'});`,
 './claims':`export const claimReadiness=()=>({enabled:false,blockers:[]});export const processLeagueClaims=async season=>{globalThis.__pflAccounting.order.push('claims');globalThis.__pflAccounting.claimSeason=season;return {action:'paused'}};`,
 '../creator-fees':`export const collectCreatorFees=async()=>globalThis.__pflAccounting.order.push('collect');`,
};
const root=new URL('../lib/',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.includes('/server/league/')&&modules[specifier])return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};
 if(specifier==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};
 if(context.parentURL?.startsWith(root)&&specifier.startsWith('.')&&!/\.[a-z]+$/.test(specifier))return next(specifier+'.ts',context);
 return next(specifier,context);
}});
const {allocateReceipts,rewardSummary,createEntitlements,prepareRewards}=await import('../lib/server/league/rewards.ts');
const {createSeason,tickLeague}=await import('../lib/server/league/service.ts');
const season={id:'pump-season',mint:'base-mint',reward_mint:PUMP,starts_at:'2026-11-10T00:00:00Z',ends_at:'2026-12-08T00:00:00Z',status:'active'};
function setup(handler){state.order=[];state.queries=[];state.verify=[];state.query=async(sql,params=[])=>{state.queries.push([sql,params]);return handler(sql,params);};process.env.PF_LEAGUE_FEE_CUTOVER='2026-11-01T00:00:00Z';process.env.PF_REWARD_ASSET='PUMP';}
test('new PUMP season adopts only same-asset finalized receipts and keeps actual30/50/20 raw units',async()=>{
 setup((sql,params)=>{
  if(sql.includes('select r.signature')){
   assert.match(sql,/r.reward_asset=\$5/);assert.match(sql,/c.reward_asset=r.reward_asset/);assert.match(sql,/competition_format='legacy'/);assert.match(sql,/c.status='finalized'/);assert.match(sql,/award_id is null/);
   assert.equal(params[4],'PUMP');return [{signature:'pump-receipt',gross_raw:'1001'}];
  }
  return [];
 });
 await allocateReceipts(season);
 const insert=state.queries.find(([sql])=>sql.startsWith('insert into pfl_fee_allocations'));
 assert.match(insert[0],/reward_asset/);assert.deepEqual(insert[1],['pump-receipt',season.id,'300','500','201','PUMP']);
});
test('PUMP summary exposes direct allocations, verifies reward mint, and never invents a conversion',async()=>{
 setup(sql=>{
  if(sql.includes('from pfl_seasons'))return [{mint:'base-mint',reward_mint:PUMP}];
  if(sql.includes('received'))return [{received:'1001',daily:'300',season:'500',champion:'201'}];
  if(sql.includes('pfl_conversions'))throw Error('PUMP must not use conversions');
  return [];
 });
 const summary=await rewardSummary(season.id,null);
 assert.equal(summary.asset,'PUMP');assert.equal(summary.tokenDecimals,6);assert.deepEqual(summary.conversions,[]);
 assert.deepEqual(summary.pools,[{pool:'daily',raw:'300'},{pool:'season',raw:'500'},{pool:'champion',raw:'201'}]);
 assert.deepEqual(state.verify,['PUMP']);assert.equal(summary.fees.asset,'PUMP');
});
test('legacy PFL summary retains verified conversions and base-token decimals',async()=>{
 setup(sql=>{
  if(sql.includes('from pfl_seasons'))return [{mint:'base-mint',reward_mint:null}];
  if(sql.includes('received'))return [{received:'100',daily:'30',season:'50',champion:'20'}];
  if(sql.includes('group by c.pool'))return [{pool:'daily',raw:'9000'}];
  if(sql.includes('select c.signature'))return [{signature:'historical-swap',status:'verified'}];
  return [];
 });
 const summary=await rewardSummary('legacy',null);
 assert.equal(summary.asset,'PFL');assert.equal(summary.tokenDecimals,9);assert.equal(summary.conversions[0].signature,'historical-swap');assert.deepEqual(state.verify,['base-mint']);
});
test('PUMP entitlement budget uses only unallocated direct PUMP and becomes available atomically after settlement',async()=>{
 setup(sql=>{
  if(sql.includes('from pfl_seasons'))return [{id:season.id,reward_mint:PUMP}];
  if(sql.endsWith('::text available')){assert.match(sql,/pfl_fee_allocations/);assert.match(sql,/reward_asset='PUMP'/);assert.doesNotMatch(sql,/pfl_conversions/);return [{available:'100'}];}
  return [];
 });
 const input={seasonId:season.id,roundId:'round',pool:'daily',period:'round:1',rows:[{wallet:'winner',points2:10}],budgetRaw:101n};
 await assert.rejects(createEntitlements(input),/Insufficient/);
 await createEntitlements({...input,budgetRaw:100n});
 const insert=state.queries.find(([sql])=>sql.startsWith('insert into pfl_entitlements'));
 assert.match(insert[0],/'pending'/);assert.equal(insert[1][5],'50');
 const settled=state.queries.find(([sql])=>sql.startsWith('insert into pfl_settlements'));assert.equal(settled[1][4],'50');
 const available=state.queries.findIndex(([sql])=>sql.startsWith('update pfl_entitlements'));assert.ok(available>state.queries.indexOf(settled));assert.match(state.queries[available][0],/status='available'/);
});
test('PUMP season creation snapshots the reward mint with no history rebind',async()=>{
 setup(()=>[]);
 await createSeason({id:'new-pump',title:'PUMP season',number:1,startsAt:'2026-12-07T00:00:00Z',weeks:1});
 const insert=state.queries.find(([sql])=>sql.startsWith('insert into pfl_seasons'));
 assert.match(insert[0],/reward_mint/);assert.equal(insert[1].at(-1),PUMP);
 assert.equal(state.queries.some(([sql])=>sql.startsWith('update pfl_seasons')),false);
});
test('PUMP daily settlement uses direct finalized fee windows and real prize weights',async()=>{
 setup((sql,params)=>{
  if(sql.includes('from pfl_days'))return [{round_id:'round',day:1,starts_at:'2026-11-10T00:00:00Z',ends_at:'2026-11-11T00:00:00Z'}];
  if(sql.includes('::text missing')){assert.doesNotMatch(sql,/pfl_conversions/);assert.match(sql,/f.reward_asset='PUMP'/);assert.deepEqual(params,[season.id,'daily','2026-11-10T00:00:00Z','2026-11-11T00:00:00Z']);return [{missing:'0',raw:'100'}];}
  if(sql.includes('select s.wallet'))return [{wallet:'winner',points2:10}];
  if(sql.includes('from pfl_seasons'))return [{reward_mint:PUMP}];
  if(sql.endsWith('::text available'))return [{available:'100'}];
  return [];
 });
 await prepareRewards(season);
 const insert=state.queries.find(([sql])=>sql.startsWith('insert into pfl_entitlements'));
 assert.deepEqual(insert[1],[season.id,'round','winner','daily','round:1','50']);
});
test('settlement replay cannot allocate another entitlement or settlement',async()=>{
 setup(sql=>{
  if(sql.includes('from pfl_seasons'))return [{reward_mint:PUMP}];
  if(sql.includes('from pfl_settlements'))return [{period:'round:1'}];
  return [];
 });
 assert.deepEqual(await createEntitlements({seasonId:season.id,roundId:'round',pool:'daily',period:'round:1',rows:[{wallet:'winner',points2:10}],budgetRaw:100n}),{alreadyAllocated:true});
 assert.equal(state.queries.some(([sql])=>sql.startsWith('insert')),false);
});
test('unknown reward mint is rejected before allocations can be adopted',async()=>{
 setup(()=>[]);
 await assert.rejects(allocateReceipts({...season,reward_mint:'wrong-mint'}),/Unsupported/);
 assert.equal(state.queries.length,0);
});
test('league worker collects, allocates and reconciles claims under its existing durable lock',async()=>{
 setup(sql=>{
  if(sql.startsWith('select * from pfl_seasons'))return [season];
  if(sql.includes('select r.signature'))state.order.push('allocate');
  return [];
 });
 process.env.PF_LEAGUE_WORKER_ENABLED='true';
 const result=await tickLeague();
 assert.equal(result.action,'processed');
 assert.deepEqual(state.order,['lock','claims','collect','allocate','unlock']);
 assert.equal(state.claimSeason.reward_mint,PUMP);assert.equal(state.claimSeason.status,'active');
});
test('legacy entitlements retain their verified conversion budget and pending status',async()=>{
 setup(sql=>{
  if(sql.includes('from pfl_seasons'))return [{reward_mint:null}];
  if(sql.endsWith('::text available')){assert.match(sql,/pfl_conversions/);assert.match(sql,/c.status='verified'/);return [{available:'100'}];}
  return [];
 });
 await createEntitlements({seasonId:'legacy',roundId:'legacy-round',pool:'daily',period:'legacy-round:1',rows:[{wallet:'legacy-winner',points2:10}],budgetRaw:100n});
 const inserted=state.queries.find(([sql])=>sql.startsWith('insert into pfl_entitlements'));assert.match(inserted[0],/'pending'/);
 assert.equal(state.queries.some(([sql])=>sql.startsWith('update pfl_entitlements')),false);
});

test('claim reconciliation precedes a failing fee allocation',async()=>{
 setup(sql=>{
  if(sql.startsWith('select * from pfl_seasons'))return [season];
  if(sql.includes('select r.signature'))throw Error('allocation unavailable');
  return [];
 });
 process.env.PF_LEAGUE_WORKER_ENABLED='true';
 await assert.rejects(tickLeague(),/allocation unavailable/);
 assert.deepEqual(state.order,['lock','claims','collect','unlock']);
});
