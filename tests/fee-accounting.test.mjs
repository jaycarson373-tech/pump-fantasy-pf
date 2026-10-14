import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCreatorFees, collectedFeesFromBalances } from '../lib/server/fee-accounting.ts';

test('one SOL of confirmed fees reserves 0.35 SOL and funds 0.65 SOL for daily rewards', () => {
 assert.deepEqual(splitCreatorFees(1_000_000_000n), {gross:1_000_000_000n,daily:650_000_000n,reserve:350_000_000n});
});
test('rounding cannot spend any of the reserve or manufacture lamports', () => {
 for (const amount of [0n,1n,9n,99n,10001n,9007199254740993n]) {
  const split = splitCreatorFees(amount);
  assert.equal(split.daily + split.reserve, amount);
  assert.ok(split.daily * 10000n <= amount * 6500n);
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
