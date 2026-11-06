import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIERS, validatePool } from '../lib/league/engine.ts';
const catalog = JSON.parse(readFileSync(new URL('../data/pumpfun-monthly-top100.json', import.meta.url)));
test('published Pump catalog has 100 distinct ranked wallets and correct tier sizes', () => {
  const players = catalog.players;
  assert.equal(players.length, 100);
  assert.equal(new Set(players.map(p => p.wallet)).size, 100);
  assert.deepEqual(players.map(p => p.rank), Array.from({length:100}, (_, i) => i + 1));
  assert.deepEqual(TIERS.map(t => players.filter(p => p.rank >= t.min && p.rank <= t.max).length), [10,20,30,40]);
  for (const [i,p] of players.entries()) {
    assert.equal(p.id, p.wallet);
    assert.ok(p.sourceUrl.startsWith('https://pump.fun/profile/'));
    assert.ok(i === 0 || BigInt(players[i-1].pnlMicros) >= BigInt(p.pnlMicros));
    assert.equal(p.trades, null);
    assert.equal(p.roiBps, null);
  }
});
test('display-only monthly catalog cannot masquerade as finalized competition evidence', () => {
  assert.throws(() => validatePool(catalog.players));
  assert.ok(Number.isFinite(Date.parse(catalog.capturedAt)));
  assert.equal(catalog.period, '1M');
});
