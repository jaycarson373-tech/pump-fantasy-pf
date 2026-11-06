import test from 'node:test';
import assert from 'node:assert/strict';
import {pumpRaw, operation, assertConfigured} from '../scripts/pfl-control.mjs';
import {leagueControlStatus} from '../lib/server/league/control-status.ts';
const future='2099-01-01T00:00:00Z';
test('operator controls preserve exact PUMP caps and refuse unsafe inputs',()=>{
 assert.equal(pumpRaw('9007199254.740993'),'9007199254740993');
 for(const amount of ['0','-1','1e6','1.0000001','NaN','18446744073709.551616'])assert.throws(()=>pumpRaw(amount));
 assert.throws(()=>operation(['payouts-on','10','1',future]));
 assert.throws(()=>operation(['payouts-on','1','10','2000-01-01T00:00:00Z']));
 const on=operation(['payouts-on','1.5','10',future]).values;
 assert.equal(on.PF_AUTO_PAYOUT_MAX_AWARD_RAW,'1500000');assert.equal(on.PF_AUTO_PAYOUT_MAX_SEASON_RAW,'10000000');
 assert.equal(on.PF_REWARD_ASSET,'PUMP');assert.equal(on.PF_LEGACY_COMPETITION,'false');
 assert.deepEqual(operation(['payouts-off']).values,{PF_AUTO_PAYOUT_ENABLED:'false',PF_AUTO_PAYOUT_RUN_UNTIL:'1970-01-01T00:00:00.000Z'});
 assert.equal(operation(['league-on']).values.PF_LEAGUE_WORKER_ENABLED,'true');
 assert.equal(operation(['start-draft','season-auto','3']).body.number,3);
 const draft=operation(['start-draft','season-2','2',future]).body;
 assert.equal(draft.openingDraftAt,'2099-01-01T00:00:00.000Z');assert.equal(draft.weeks,4);
 assert.throws(()=>operation(['start-draft','bad id','2',future]));
 assert.throws(()=>operation(['airdrop','arbitrary-wallet','100']));
});
test('status checks secret presence without ever reading secret values',()=>{
 const env={PF_REWARD_ASSET:'PUMP',PF_AUTO_PAYOUT_ENABLED:'false'};
 for(const name of ['PF_PAYOUT_SIGNER_KEYPAIR_JSON','PF_SESSION_SECRET','DATABASE_URL','PF_DATA_INGEST_SECRET'])
  Object.defineProperty(env,name,{enumerable:true,get(){throw Error('Secret value read');}});
 const status=leagueControlStatus(env);
 assert.equal(status.present.PF_PAYOUT_SIGNER_KEYPAIR_JSON,true);
 assert.equal(status.settings.PF_AUTO_PAYOUT_ENABLED,'false');
 assert.equal(JSON.stringify(status).includes('Secret value read'),false);
 assert.throws(()=>assertConfigured(status,true),/Configure/);
});

test('draft creation refuses a legacy reward configuration before immutable season creation',()=>{
 const present=Object.fromEntries(['DATABASE_URL','PF_SESSION_SECRET','SOLANA_RPC_URL','PF_RANKINGS_URL','PF_PNL_URL','PF_ELIGIBILITY_URL'].map(n=>[n,true]));
 const status={present,mintConfigured:true,settings:{PF_LEAGUE_WORKER_ENABLED:'true',PF_REWARD_ASSET:'SOL'}};
 assert.throws(()=>assertConfigured(status,false),/persist PUMP/);
 assert.equal(operation(['league-on']).values.PF_REWARD_ASSET,'PUMP');
 status.settings.PF_REWARD_ASSET='PUMP';assert.doesNotThrow(()=>assertConfigured(status,false));
});
