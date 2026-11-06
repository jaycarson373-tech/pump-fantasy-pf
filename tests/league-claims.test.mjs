import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({resolve(s,c,next){
 if(s==='next/server')return next('next/server.js',c);
 if(s==='server-only')return {url:'data:text/javascript,export {}',shortCircuit:true};
 if(s.startsWith('.')&&!/\.[a-z]+$/.test(s)&&existsSync(new URL(s+'.ts',c.parentURL)))return next(s+'.ts',c);
 return next(s,c);
}});
const { claimReadiness }=await import('../lib/server/league/claims.ts');
const PUMP='pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';
test('readiness is key-free and requires explicit PUMP identity, caps, switches and deadline',()=>{
 const names=['PF_AUTO_PAYOUT_ENABLED','PF_LEAGUE_WORKER_ENABLED','PF_PAYOUT_NETWORK','PF_REWARD_ASSET','PF_AUTO_PAYOUT_MAX_AWARD_RAW','PF_AUTO_PAYOUT_MAX_SEASON_RAW','PF_AUTO_PAYOUT_RUN_UNTIL','PF_PAYOUT_SIGNER_KEYPAIR_JSON','PF_PRIZE_WALLET_ADDRESS','PF_CREATOR_WALLET_ADDRESS'];
 assert.equal(Object.hasOwn(process.env,'PF_PAYOUT_SIGNER_KEYPAIR_JSON'),false,'Run key-free; tests supply only dummy configuration.');
 const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
 Object.assign(process.env,{PF_AUTO_PAYOUT_ENABLED:'true',PF_LEAGUE_WORKER_ENABLED:'true',PF_PAYOUT_NETWORK:'mainnet-beta',PF_REWARD_ASSET:'PUMP',PF_AUTO_PAYOUT_MAX_AWARD_RAW:'1000000',PF_AUTO_PAYOUT_MAX_SEASON_RAW:'2000000',PF_AUTO_PAYOUT_RUN_UNTIL:new Date(Date.now()+60000).toISOString(),PF_PAYOUT_SIGNER_KEYPAIR_JSON:'not-a-key',PF_PRIZE_WALLET_ADDRESS:'So11111111111111111111111111111111111111112',PF_CREATOR_WALLET_ADDRESS:'So11111111111111111111111111111111111111112'});
 assert.equal(claimReadiness({mint:'So11111111111111111111111111111111111111112',reward_mint:PUMP}).enabled,true);
 for(const n of ['PF_AUTO_PAYOUT_MAX_AWARD_RAW','PF_AUTO_PAYOUT_MAX_SEASON_RAW']){const old=process.env[n];delete process.env[n];assert.equal(claimReadiness({mint:PUMP,reward_mint:PUMP}).enabled,false);process.env[n]=old;}
 assert.equal(claimReadiness({mint:PUMP,reward_mint:null}).enabled,false);
 process.env.PF_AUTO_PAYOUT_ENABLED='false';assert.equal(claimReadiness({mint:PUMP,reward_mint:PUMP}).enabled,false);
 }finally{for(const n of names){if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}}
});
