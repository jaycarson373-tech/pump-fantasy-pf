import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCreatorFees, collectedFeesFromBalances } from '../lib/server/fee-accounting.ts';

test('one SOL funds 30% daily, 50% season, and 20% championship reserves', () => {
 assert.deepEqual(splitCreatorFees(1_000_000_000n), {gross:1_000_000_000n,daily:300_000_000n,season:500_000_000n,reserve:200_000_000n});
});
test('rounding cannot spend any of the reserve or manufacture lamports', () => {
 for (const amount of [0n,1n,9n,99n,10001n,9007199254740993n]) {
  const split = splitCreatorFees(amount);
  assert.equal(split.daily + split.season + split.reserve, amount);
  assert.ok(split.daily * 10000n <= amount * 3000n);
  assert.ok(split.season * 10000n <= amount * 5000n);
  assert.ok(split.reserve * 10000n >= amount * 2000n);
 }
 assert.throws(() => splitCreatorFees(-1n));
});
test('collects only confirmed Pump and AMM vault withdrawals, excluding unrelated deposits and rent', () => {
 const keys = ['payer','sol-vault','amm-ata'];
 const meta = {err:null,preBalances:[10,2000039,2039280],postBalances:[900000000,39,2039280],preTokenBalances:[{accountIndex:2,mint:'wsol',uiTokenAmount:{amount:'3000000'}}],postTokenBalances:[{accountIndex:2,mint:'wsol',uiTokenAmount:{amount:'0'}}]};
 assert.equal(collectedFeesFromBalances(keys,meta,'sol-vault','amm-ata','wsol'),5000000n);
});
test('missing AMM balances add zero while failed or invalid claims cannot fund rewards', () => {
 const meta = {err:null,preBalances:[50000],postBalances:[0]};
 assert.equal(collectedFeesFromBalances(['sol-vault'],meta,'sol-vault','absent','wsol'),50000n);
 assert.throws(() => collectedFeesFromBalances(['sol-vault'], {...meta,err:{InstructionError:1}},'sol-vault','absent','wsol'));
 assert.throws(() => collectedFeesFromBalances(['sol-vault'], {...meta,postBalances:[90000]},'sol-vault','absent','wsol'));
 assert.throws(() => collectedFeesFromBalances(['sol-vault'], {...meta,preBalances:[Number.MAX_SAFE_INTEGER+1]},'sol-vault','absent','wsol'));
});

test('PUMP finalized credit equals destination increase and matching known source withdrawals',async()=>{
 const {collectedTokenFeesFromBalances}=await import('../lib/server/fee-accounting.ts');
 const keys=['creator-ata','curve-ata','vault-ata','amm-ata','pool-ata','unrelated'];
 const owners=['creator','curve','vault','amm','pool','stranger'];
 const balance=(accountIndex,amount)=>({accountIndex,mint:'pump',owner:owners[accountIndex],programId:'token',uiTokenAmount:{amount:String(amount),decimals:6}});
 const meta={err:null,preTokenBalances:[balance(1,100),balance(2,30),balance(3,20),balance(4,1000),balance(5,1)],postTokenBalances:[balance(0,70),balance(1,90),balance(2,0),balance(3,0),balance(4,990),balance(5,999)]};
 const sources=keys.slice(1,5).map((address,i)=>({address,owner:owners[i+1]}));
 const call=(m=meta)=>collectedTokenFeesFromBalances(keys,m,{address:keys[0],owner:owners[0]},sources,{mint:'pump',tokenProgram:'token',decimals:6});
 assert.equal(call(),70n);
 for(const field of ['mint','owner','programId']){const bad=structuredClone(meta);bad.postTokenBalances[0][field]='wrong';assert.throws(()=>call(bad));}
 const bad=structuredClone(meta);bad.postTokenBalances[0].uiTokenAmount.decimals=9;assert.throws(()=>call(bad));
 const extra=structuredClone(meta);extra.postTokenBalances[0].uiTokenAmount.amount='999';assert.throws(()=>call(extra),/source/);
 assert.throws(()=>call({...meta,err:{failed:true}}));
 assert.throws(()=>call({...meta,postTokenBalances:[]}));
 const duplicate=structuredClone(meta);duplicate.postTokenBalances.push(duplicate.postTokenBalances[0]);assert.throws(()=>call(duplicate));
});
