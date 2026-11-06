// Real launch and holder-check modules against disposable PostgreSQL; only upstream HTTP is mocked.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const dbUrl=new URL(process.env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(dbUrl.hostname)&&dbUrl.pathname.startsWith('/pf_launch_test'),'Use a disposable local pf_launch_test database.');
assert.ok(!process.env.PF_PAYOUT_SIGNER_KEYPAIR_JSON,'Run without a signing key.');
Object.assign(process.env,{PF_SESSION_SECRET:'local-disposable-session-secret-only',PF_DATA_INGEST_SECRET:'local-disposable-admin-session',SOLANA_RPC_URL:'https://solana.fixture.invalid',FANTASY_MINT_ADDRESS:'11111111111111111111111111111111',PF_PRIZE_WALLET_ADDRESS:'11111111111111111111111111111111',PF_REWARD_MODE:'creator-fees',PF_AUTO_PAYOUT_ENABLED:'false',PF_FEE_COLLECTION_ENABLED:'false',FANTASY_MINIMUM_TOKENS:'500000'});
const root=new URL('../',import.meta.url).href;
registerHooks({resolve(specifier,context,next){
 if(['next/server','next/headers'].includes(specifier))return next(`${specifier}.js`,context);
 const local=context.parentURL?.startsWith(root+'lib/server/')||context.parentURL?.startsWith(root+'app/');
 return next(local&&specifier.startsWith('.')&&!/\.[a-z]+$/.test(specifier)?`${specifier}.ts`:specifier,context);
}});
const {getSeasonLaunchReadiness}=await import('../lib/server/season-launch-readiness.ts');
const {POST}=await import('../app/api/admin/season/start/route.ts');
const {getEntryBalance}=await import('../lib/server/solana.ts');
const {queryRows,closeDatabasePool}=await import('../lib/server/database.ts');
let mintLive=false;let rawBalance='0';let rpcCalls=0;
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(new URL(url).hostname==='frontend-api-v3.pump.fun')return new Response('Blocked',{status:403});
 assert.equal(new URL(url).hostname,'solana.fixture.invalid');rpcCalls++;
 const {method,params}=JSON.parse(options.body);
 if(method==='getGenesisHash')return Response.json({result:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'});
 if(method==='getTokenSupply')return Response.json(mintLive?{result:{value:{amount:'1000000000000000',decimals:6}}}:{error:{message:'Mint is not initialized'}});
 if(method==='getTokenAccountsByOwner')return Response.json({result:{value:params[1].programId.startsWith('Tokenkeg')?[{account:{data:{parsed:{info:{mint:process.env.FANTASY_MINT_ADDRESS,tokenAmount:{amount:rawBalance}}}}}}]:[]}});
 throw Error('Unexpected external operation: '+method);
};
try{
 const readiness=await getSeasonLaunchReadiness();assert.equal(readiness.ready,true,readiness.blockers.join('; '));assert.equal(readiness.players.length,50);assert.equal(rpcCalls,0,'Opening must not depend on a minted token or payout readiness');
 const request=()=>new Request('https://www.pumpfunfantasy.xyz/api/admin/season/start',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.PF_DATA_INGEST_SECRET},body:JSON.stringify({action:'open'})});
 const response=await POST(request());const opened=await response.json();assert.equal(response.status,200,JSON.stringify(opened));assert.equal(opened.seasonId,'season-1');assert.equal(opened.phase,'draft');assert.equal(Date.parse(opened.draftLocksAt)-Date.parse(opened.opensAt),3_600_000);
 assert.equal((await queryRows("select count(*)::int as n from pf_players where season_id='season-1'"))[0].n,50);
 const wallet='22222222222222222222222222222222';
 await assert.rejects(getEntryBalance(wallet,'season-1'),/Mint is not initialized/);
 mintLive=true;assert.equal((await getEntryBalance(wallet,'season-1')).eligible,false);
 rawBalance='499999000000';assert.equal((await getEntryBalance(wallet,'season-1')).eligible,false);
 rawBalance='500000000000';const eligible=await getEntryBalance(wallet,'season-1');assert.equal(eligible.eligible,true);assert.equal(eligible.minimumTokens,'500000');
 assert.notEqual((await POST(request())).status,200,'Cannot restart an open draft');
 assert.equal(process.env.PF_AUTO_PAYOUT_ENABLED,'false');assert.equal((await queryRows('select count(*)::int as n from pf_daily_awards'))[0].n,0);
 console.log('PASS: real 60-minute draft opens before mint/payout readiness; 50 frozen players; uninitialized token rejected; zero/below500k denied;500k accepted after mint; duplicate launch refused; no award or payout activation.');
}finally{globalThis.fetch=realFetch;await closeDatabasePool();}
