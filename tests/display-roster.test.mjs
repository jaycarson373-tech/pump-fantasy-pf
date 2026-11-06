import test from 'node:test';
import assert from 'node:assert/strict';
import { displayRoster, savedRoster } from '../lib/league/display-roster.ts';

test('saved Pump monthly field contains all 100 real unique ranked wallets', () => {
  const { players, snapshotAt } = savedRoster;
  assert.equal(players.length, 100);
  assert.equal(new Set(players.map(p => p.wallet)).size, 100);
  assert.ok(Number.isFinite(Date.parse(snapshotAt)));
  players.forEach((p, i) => {
    assert.equal(p.rank, i + 1);
    assert.match(p.wallet, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.match(p.pnlMicros, /^-?\d+$/);
    assert.equal(p.trades, null, 'Pump positions are not qualifying trade counts');
    assert.equal(p.sourceUrl, `https://pump.fun/profile/${p.wallet}`);
    if (i) assert.ok(BigInt(players[i - 1].pnlMicros) >= BigInt(p.pnlMicros));
  });
});

test('empty/unavailable season displays saved field; complete season keeps exact identities', () => {
  assert.equal(displayRoster(undefined).players, savedRoster.players);
  assert.equal(displayRoster([]).preview, true);
  const frozen = savedRoster.players.map(p => ({ ...p, id: `season:${p.wallet}`, trades: 5 }));
  const result = displayRoster(frozen);
  assert.equal(result.players, frozen);
  assert.equal(result.preview, false);
});
