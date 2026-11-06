import test from 'node:test';
import assert from 'node:assert/strict';
import * as assets from '../lib/reward-asset.ts';

test('formats token base units without losing integer precision or using SOL decimals', () => {
  assert.equal(assets.formatRewardAmount('1000001', 'PUMP'), '1.000001');
  assert.equal(assets.formatRewardAmount('9007199254740993', 'PUMP'), '9,007,199,254.740993');
  assert.equal(assets.formatRewardAmount('1000001', 'SOL'), '0.001000001');
  assert.equal(assets.formatRewardAmount('0', 'PUMP'), '0');
});
test('rejects unknown assets and invalid amounts instead of selecting SOL silently', () => {
  for (const value of ['', 'pump', 'USDC', null]) assert.throws(() => assets.rewardAsset(value));
  for (const value of ['-1', '1.2', 'NaN']) assert.throws(() => assets.formatRewardAmount(value, 'PUMP'));
});
