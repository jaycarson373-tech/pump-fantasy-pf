import test from 'node:test';
import assert from 'node:assert/strict';
import { isWalletTestSeason, canUseWalletTestEntry } from '../lib/server/season-window.ts';
const id='wallet-test-01234567-89ab-4cde-8fab-0123456789ab';
const open={status:'open',opens_at:'2026-11-05T12:00:00Z',locked_at:'2026-11-05T13:00:00Z',closes_at:'2026-11-07T13:00:00Z'};
test('only an isolated open test draft can waive the token gate',()=>{
 assert.equal(canUseWalletTestEntry(id,open,Date.parse('2026-11-05T12:30:00Z')),true);
 assert.equal(canUseWalletTestEntry('season-1',open,Date.parse('2026-11-05T12:30:00Z')),false);
 assert.equal(canUseWalletTestEntry(id,open,Date.parse(open.locked_at)),false);
 assert.equal(canUseWalletTestEntry(id,{...open,status:'complete'},Date.parse('2026-11-05T12:30:00Z')),false);
 assert.equal(isWalletTestSeason('wallet-test-not-a-valid-id'),false);
});
