import test from 'node:test';
import assert from 'node:assert/strict';
import { canStartDraftEntry, createDraftEntryAction } from '../lib/draft-entry-action.ts';

const ready = { busy: false, pickCount: 5, requiredPicks: 5, authenticated: false, eligible: false, draftOpen: true, rosterReady: true };
test('five picks in an open draft can start wallet verification before eligibility', () => {
  assert.equal(canStartDraftEntry(ready), true);
  assert.equal(canStartDraftEntry({ ...ready, authenticated: true, eligible: true }), true);
  assert.equal(canStartDraftEntry({ ...ready, authenticated: true }), false);
  for (const change of [{busy:true},{pickCount:4},{draftOpen:false},{rosterReady:false}]) {
    assert.equal(canStartDraftEntry({ ...ready, ...change }), false);
  }
});
test('one click waits for verification then submits once; repeated clicks share the request', async () => {
  const action = createDraftEntryAction();
  let resolveVerification;
  const verified = new Promise(resolve => { resolveVerification = resolve; });
  let submissions = 0;
  const first = action.run(() => verified, async () => { submissions++; });
  const repeated = action.run(() => { throw Error('duplicate verification'); }, async () => { submissions++; });
  assert.equal(first, repeated);
  assert.equal(submissions, 0);
  resolveVerification(true);
  await first;
  assert.equal(submissions, 1);
});
test('cancelled or failed verification cannot submit and a later click can retry', async () => {
  const action = createDraftEntryAction();
  let submissions = 0;
  const submit = async () => { submissions++; };
  await action.run(async () => false, submit);
  await assert.rejects(action.run(async () => { throw Error('cancelled'); }, submit), /cancelled/);
  assert.equal(submissions, 0);
  await action.run(async () => true, submit);
  assert.equal(submissions, 1);
});
test('leaving the draft while verification is pending cancels its submission', async () => {
  const action = createDraftEntryAction();
  let resolveVerification;
  let submissions = 0;
  const verified = new Promise(resolve => { resolveVerification = resolve; });
  const request = action.run(() => verified, async () => { submissions++; });
  action.cancel();
  resolveVerification(true);
  await request;
  assert.equal(submissions, 0);
});

test('trusted six-player seasons require six picks and complete roster data', () => {
  assert.equal(canStartDraftEntry({ ...ready, requiredPicks: 6, pickCount: 5 }), false);
  assert.equal(canStartDraftEntry({ ...ready, requiredPicks: 6, pickCount: 6 }), true);
  assert.equal(canStartDraftEntry({ ...ready, requiredPicks: 6, pickCount: 6, rosterReady: false }), false);
  assert.equal(canStartDraftEntry({ ...ready, requiredPicks: 0 }), false);
});
