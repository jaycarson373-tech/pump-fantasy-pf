import test from "node:test";
import assert from "node:assert/strict";
import { parseCommunityProfile, parseCommunityPnl } from "../lib/community-data.ts";
const wallet="11111111111111111111111111111111";
const now=Date.now();
test("profile binds the canonical wallet, rejects groups and unregistered accounts",()=>{
 const profile={address:wallet,canonical_svm_wallet:wallet,username:"Player",profile_image:null,is_pump_user:true,kind:"person"};
 assert.equal(parseCommunityProfile(profile,wallet).display_name,"Player");
 for(const patch of [{canonical_svm_wallet:"other"},{kind:"group"},{is_pump_user:false},{username:""}]) assert.throws(()=>parseCommunityProfile({...profile,...patch},wallet));
});
test("community PnL rejects missing, wrong-wallet, stale and incomplete price data",()=>{
 const data={wallet,pnl:{usd:42},computedAt:now,missingPriceMints:[]};
 assert.equal(parseCommunityPnl(data,wallet,now).pnl_usd,42);
 for(const patch of [{wallet:"other"},{pnl:{usd:null}},{pnl:{usd:Infinity}},{computedAt:now-600000},{computedAt:now+600000},{missingPriceMints:["unpriced"]}]) assert.throws(()=>parseCommunityPnl({...data,...patch},wallet,now));
});
