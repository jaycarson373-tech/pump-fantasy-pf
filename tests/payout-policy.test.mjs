import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitPayoutCap, finalizedPayoutDisposition, RESERVED_AWARD_STATUSES, seasonAwardFits } from '../lib/server/payout-policy.ts';

test('creator-fee mode cannot turn missing or malformed payout caps into unlimited authorization', () => {
  for(const value of [undefined,'','0','-1','1.5','1e9','9223372036854775807'])assert.equal(explicitPayoutCap(value),null);
  assert.equal(explicitPayoutCap('1000000'),1_000_000n);
});
test('a pending/unknown or historically failed signed award still occupies the season budget', () => {
  assert.ok(RESERVED_AWARD_STATUSES.includes('payment_unknown'));
  assert.ok(RESERVED_AWARD_STATUSES.includes('payment_failed'));
  const cap=1_000_000n, uncertainAward=650_000n;
  assert.equal(seasonAwardFits(cap,uncertainAward,400_000n),false);
  assert.equal(seasonAwardFits(cap,uncertainAward,350_000n),true);
});
test('a fork-visible error cannot release a payout or erase its persisted signature', () => {
  assert.equal(finalizedPayoutDisposition({confirmationStatus:'processed',err:{InstructionError:[0,'failure']}}),'pending');
  assert.equal(finalizedPayoutDisposition({confirmationStatus:'confirmed',err:null}),'pending');
  assert.equal(finalizedPayoutDisposition(null),'absent');
  assert.equal(finalizedPayoutDisposition({confirmationStatus:'finalized',err:null}),'paid');
  assert.equal(finalizedPayoutDisposition({confirmationStatus:'finalized',err:{InstructionError:[0,'failure']}}),'failed');
});
