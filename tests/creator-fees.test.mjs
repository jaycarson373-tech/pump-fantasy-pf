import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {address,getAddressEncoder} from '@solana/kit';
import {quoteCollectionAddresses,PUMP_MINT,PUMP,TOKEN,WSOL} from '../lib/server/creator-protocol.mjs';
import schemas from '../lib/server/protocol/creator-fees.json' with {type:'json'};

// Only external network/database/signer boundaries are substituted. Production
// builders, account decoders, recovery, wire matching and allocation run unchanged.
const modules={
 './database':`export const queryRows=(...args)=>globalThis.__pfCollection.query(...args);export const withTransaction=fn=>fn(queryRows);`,
 './config':`export const getBackendConfig=()=>globalThis.__pfCollection.config;`,
 './fee-treasury':`export const getFeeTreasury=(...args)=>{globalThis.__pfCollection.treasuryCalls.push(args);return {gross:1000000n,paid:0n,leagueSolReserved:globalThis.__pfCollection.leagueSolReserved??0n};};`,
 './payout-signer':`export const payoutSigner=()=>{throw Error('Unexpected signer access in offline test');};export const signPayout=payoutSigner;`,
 './solana':`export const verifyMainnetRpc=async()=>{};`,
};
const root=new URL('../lib/',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/creator-fees.ts')&&modules[specifier])return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};
 if(specifier==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};
 if(context.parentURL?.startsWith(root)&&specifier.startsWith('.')&&!/\.[a-z]+$/.test(specifier))return next(specifier+'.ts',context);
 return next(specifier,context);
}});
const {collectCreatorFees,creatorFeeConfigurationBlockers}=await import('../lib/server/creator-fees.ts');
const creator='9xQeWvG816bUx9EPfEZTh2dpX1boA9E3B9Lm7bJiGx3F',mint=WSOL;
const a=await quoteCollectionAddresses(creator,mint,PUMP_MINT);
const curve=Buffer.alloc(133);Buffer.from(schemas[0].curve_discriminator).copy(curve);Buffer.from(getAddressEncoder().encode(address(creator))).copy(curve,49);Buffer.from(getAddressEncoder().encode(address(PUMP_MINT))).copy(curve,83);
const quote=Buffer.alloc(82);quote[44]=6;quote[45]=1;
const account=(owner,data)=>({owner,data:[data.toString('base64'),'base64']});
const token=(owner,amount)=>({owner:TOKEN,data:{parsed:{info:{mint:PUMP_MINT,owner,state:'initialized',tokenAmount:{amount:String(amount),decimals:6}}}}});
const balance=(accountIndex,owner,amount)=>({accountIndex,owner,programId:TOKEN,mint:PUMP_MINT,uiTokenAmount:{amount:String(amount),decimals:6}});
const originalFetch=globalThis.fetch;
function setup(){
 process.env.PF_FEE_COLLECTION_ENABLED='true';process.env.PF_CREATOR_WALLET_DEDICATED='true';process.env.PF_CREATOR_WALLET_ADDRESS=creator;process.env.PF_PRIZE_WALLET_ADDRESS=creator;process.env.PF_REWARD_ASSET='PUMP';
 const state={config:{mint,rpcUrl:'https://offline.invalid'},queries:[],treasuryCalls:[],query:async()=>[],respond:()=>{throw Error('Unexpected RPC');}};
 globalThis.__pfCollection=state;
 state.query=async(sql,params)=>{state.queries.push([sql,params]);return [];};
 globalThis.fetch=async(_url,options)=>new Response(JSON.stringify({result:await state.respond(JSON.parse(options.body))}));
 return state;
}
test.after(()=>{globalThis.fetch=originalFetch;delete globalThis.__pfCollection;});

test('onchain preflight rejects mismatched quote, mint program/decimals and fee modes before signer access',async()=>{
 const state=setup();
 state.respond=({params})=>({value:params[0]===a.curve?account(PUMP,curve):account(TOKEN,quote)});
 assert.deepEqual(await creatorFeeConfigurationBlockers(),[]);
 process.env.PF_REWARD_ASSET='SOL';assert.equal((await creatorFeeConfigurationBlockers()).length,1);process.env.PF_REWARD_ASSET='PUMP';
 for(const offset of [82,124]){curve[offset]=1;assert.equal((await creatorFeeConfigurationBlockers()).length,1);curve[offset]=0;}
 quote[44]=9;assert.equal((await creatorFeeConfigurationBlockers()).length,1);quote[44]=6;
 state.respond=({params})=>({value:params[0]===a.curve?account(PUMP,curve):account(PUMP,quote)});
 assert.equal((await creatorFeeConfigurationBlockers()).length,1);
});

test('PUMP collection protects existing SOL liabilities and uses no reward tokens for gas',async()=>{
 const state=setup();state.leagueSolReserved=3000000n;
 state.respond=({method,params})=>{
  if(method==='getAccountInfo')return {value:params[0]===a.curve?account(PUMP,curve):account(TOKEN,quote)};
  if(method==='getMultipleAccounts')return {value:[token(a.solVault,100000),null,token(a.curve,1000),null,token(creator,500000)]};
  if(method==='getBalance')return {value:6000000};
  throw Error('Unexpected RPC '+method);
 };
 assert.equal(await collectCreatorFees(),'collection-needs-gas');
 assert.deepEqual(state.treasuryCalls,[[mint,'SOL']]);
 assert.equal(state.queries.some(([sql])=>sql.startsWith('insert')),false);
});

test('persisted PUMP claim recovers by its recorded asset after config changes and credits raw units once',async()=>{
 const state=setup(),wire=Buffer.from('persisted offline wire').toString('base64');
 process.env.PF_REWARD_ASSET='SOL';
 const claim={signature:'offline-claim',mint_address:mint,creator_wallet:creator,reward_asset:'PUMP',transaction_base64:wire,last_valid_block_height:'10',status:'prepared'};
 const parsed={slot:123,meta:{err:null,preBalances:[],postBalances:[],preTokenBalances:[balance(1,a.solVault,100000)],postTokenBalances:[balance(0,creator,100000),balance(1,a.solVault,0)]},transaction:{signatures:[claim.signature],message:{accountKeys:[{pubkey:a.creatorATA},{pubkey:a.solVaultATA}]}}};
 state.query=async(sql,params)=>{state.queries.push([sql,params]);return sql.startsWith('select *')?[claim]:[];};
 state.respond=({method,params})=>{
  if(method==='getSignatureStatuses')return {value:[{err:null,confirmationStatus:'finalized'}]};
  if(method==='getTransaction')return params[1].encoding==='base64'?{slot:123,meta:{err:null},transaction:[wire,'base64']}:parsed;
  throw Error('Unexpected RPC '+method);
 };
 assert.equal(await collectCreatorFees(),'claim-finalized');
 const inserted=state.queries.find(([sql])=>sql.startsWith('insert'));
 assert.match(inserted[0],/reward_asset,gross_raw,daily_raw,season_raw,reserve_raw/);
 assert.deepEqual(inserted[1],[claim.signature,mint,'PUMP','100000','30000','50000','20000']);
 const bad=structuredClone(parsed);bad.meta.postTokenBalances[0].owner='wrong-owner';
 state.respond=({method,params})=>method==='getSignatureStatuses'?{value:[{err:null,confirmationStatus:'finalized'}]}:params[1].encoding==='base64'?{slot:123,meta:{err:null},transaction:[wire,'base64']}:bad;
 await assert.rejects(collectCreatorFees(),/identity/);
});

test('simulation must preserve SOL liabilities after real token-account rent and fees',async()=>{
 const state=setup();
 state.respond=({method,params})=>{
  if(method==='getAccountInfo')return {value:params[0]===a.curve?account(PUMP,curve):account(TOKEN,quote)};
  if(method==='getMultipleAccounts')return {value:[token(a.solVault,100000),null,token(a.curve,1000),null,null]};
  if(method==='getBalance')return {value:10000000};
  if(method==='getLatestBlockhash')return {value:{blockhash:WSOL,lastValidBlockHeight:123}};
  if(method==='getFeeForMessage')return {value:5000};
  if(method==='simulateTransaction'){
   assert.deepEqual(params[1].accounts,{addresses:[creator],encoding:'base64'});
   return {value:{err:null,accounts:[{lamports:3000000}]}};
  }
  throw Error('Unexpected RPC '+method);
 };
 assert.equal(await collectCreatorFees(),'collection-needs-gas');
 assert.equal(state.queries.some(([sql])=>sql.startsWith('insert')),false);
});

test('unknown prepared claims rebroadcast only persisted bytes and expired claims remain unreplaced',async()=>{
 const state=setup(),claim={signature:'offline-persisted',mint_address:mint,creator_wallet:creator,reward_asset:'PUMP',transaction_base64:Buffer.from('exact original bytes').toString('base64'),last_valid_block_height:'100',status:'unknown'};
 state.query=async(sql,params)=>{state.queries.push([sql,params]);return sql.startsWith('select *')?[claim]:[];};
 let height=99,sends=0;
 state.respond=({method,params})=>{
  if(method==='getSignatureStatuses')return {value:[null]};
  if(method==='getBlockHeight')return height;
  if(method==='sendTransaction'){assert.equal(params[0],claim.transaction_base64);sends++;return claim.signature;}
  throw Error('Unexpected RPC '+method);
 };
 assert.equal(await collectCreatorFees(),'claim-submitted');assert.equal(sends,1);
 height=101;assert.equal(await collectCreatorFees(),'claim-needs-reconciliation');assert.equal(sends,1);
 assert.equal(state.queries.some(([sql])=>sql.startsWith('insert')),false);
});

test('historical SOL claim remains SOL when the active configuration becomes PUMP',async()=>{
 const {creatorAddresses}=await import('../lib/server/creator-protocol.mjs');
 const legacy=await creatorAddresses(creator),state=setup(),wire=Buffer.from('historical sol wire').toString('base64');
 const claim={signature:'historical-sol',mint_address:mint,creator_wallet:creator,reward_asset:'SOL',transaction_base64:wire,last_valid_block_height:'100',status:'prepared'};
 state.query=async(sql,params)=>{state.queries.push([sql,params]);return sql.startsWith('select *')?[claim]:[];};
 state.respond=({method,params})=>{
  if(method==='getSignatureStatuses')return {value:[{err:null,confirmationStatus:'finalized'}]};
  if(params[1].encoding==='base64')return {slot:1,meta:{err:null},transaction:[wire,'base64']};
  return {slot:1,meta:{err:null,preBalances:[500000],postBalances:[0]},transaction:{signatures:[claim.signature],message:{accountKeys:[{pubkey:legacy.solVault}]}}};
 };
 assert.equal(await collectCreatorFees(),'claim-finalized');
 assert.deepEqual(state.queries.find(([sql])=>sql.startsWith('insert'))[1],[claim.signature,mint,'SOL','500000','150000','250000','100000']);
});
