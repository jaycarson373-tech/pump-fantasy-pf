import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../data/pumpfun-monthly-top100.json' with {type:'json'};
import { validatePool, validateRosterSelection, eligibleBalance } from '../lib/league/engine.ts';

test('saved catalog supports test selections without inventing qualifying trade counts', () => {
  const picks = [0,10,11,30,31,60,61].map(i=>catalog.players[i].id);
  assert.throws(()=>validatePool(catalog.players));
  validateRosterSelection(catalog.players,picks,picks[0]);
  assert.throws(()=>validateRosterSelection(catalog.players,picks.slice(1),picks[0]));
  assert.throws(()=>validateRosterSelection(catalog.players,[...picks.slice(0,6),picks[0]],picks[0]));
  assert.throws(()=>validateRosterSelection(catalog.players,picks,'unknown'));
  assert.equal(eligibleBalance('499999999999',6),false);
  assert.equal(eligibleBalance('500000000000',6),true);
  assert.equal(catalog.players[0].trades,null);
});
