import test from 'node:test';
import assert from 'node:assert/strict';
import { promoSeasonClock } from '../lib/promo-clock.ts';

test('broadcast season clock uses the final published round, not the displayed week', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  assert.equal(promoSeasonClock([{ ends_at: '2026-11-02T00:00:00Z' }, { ends_at: '2026-11-04T02:30:00Z' }], now), 'Season clock · 3d 2h 30m remaining');
});
test('broadcast clock never invents a countdown without a valid schedule or hydration', () => {
  assert.equal(promoSeasonClock([], Date.now()), 'The title chase starts at kickoff');
  assert.equal(promoSeasonClock([{ ends_at: 'invalid' }], Date.now()), 'The title chase starts at kickoff');
  assert.equal(promoSeasonClock([{ ends_at: '2026-11-04T00:00:00Z' }], 0), 'The title chase starts at kickoff');
  assert.equal(promoSeasonClock([{ ends_at: '2026-11-04T00:00:00Z' }], Date.parse('2026-11-05T00:00:00Z')), 'Season clock complete · See the standings');
});
