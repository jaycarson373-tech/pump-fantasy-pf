// Real local HTTP/session/database flow; disposable key stays only in memory.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { getAddressDecoder } from '@solana/kit';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3187';
const url = new URL(base);
assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname), 'This test only targets a local no-prize draft.');
let cookie = '';
async function request(path, method = 'GET', body, origin = url.origin) {
  const response = await fetch(base + path, {
    method, redirect: 'error',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const nextCookie = response.headers.get('set-cookie');
  if (nextCookie) cookie = nextCookie.split(';')[0];
  return { status: response.status, body: await response.json() };
}
const state = await request('/api/entry');
assert.match(state.body.seasonId, /^wallet-test-/);
assert.equal(state.body.phase, 'draft');
const roster = (await request('/api/players')).body;
assert.equal(roster.players.length, 50);
const picks = [0, 10, 20, 30, 40].map(index => roster.players[index].id);
assert.equal((await request('/api/entry', 'PUT', { picks })).status, 401);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const wallet = getAddressDecoder().decode(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
assert.equal((await request('/api/auth/challenge', 'POST', { wallet }, 'https://unlisted.invalid')).status, 403);
const challenge = await request('/api/auth/challenge', 'POST', { wallet });
assert.equal(challenge.status, 200, 'Local origin must reach the configured sign-in route.');
assert.ok(challenge.body.message.startsWith(`${url.host} wants you to sign in`));
const signed = { wallet, message: challenge.body.message, signature: sign(null, Buffer.from(challenge.body.message), privateKey).toString('base64') };
const verified = await request('/api/auth/verify', 'POST', signed);
assert.equal(verified.status, 200);
assert.equal(verified.body.eligible, true);
assert.ok(cookie.startsWith('pf_session='));
assert.equal((await request('/api/auth/verify', 'POST', signed)).status, 401, 'Nonce replay rejected');
assert.equal((await request('/api/entry', 'PUT', { picks: Array(5).fill(picks[0]) })).status, 400);
assert.equal((await request('/api/entry', 'PUT', { picks: roster.players.slice(0, 5).map(p => p.id) })).status, 400);
assert.equal((await request('/api/entry', 'PUT', { picks })).status, 200);
assert.deepEqual((await request('/api/entry')).body.entry.picks, picks);
assert.equal((await request('/api/auth/session')).body.authenticated, true);
const edits = [1, 11, 21, 31, 41].map(index => roster.players[index].id);
assert.equal((await request('/api/entry', 'PUT', { picks: edits })).status, 200);
assert.deepEqual((await request('/api/entry')).body.entry.picks, edits);
assert.equal((await request('/api/auth/session', 'DELETE')).status, 200);
assert.equal((await request('/api/auth/session')).body.authenticated, false);
assert.equal((await request('/api/entry', 'PUT', { picks })).status, 401);
process.stdout.write('PASS: local origin, signed challenge, replay rejection, session, five picks, readback, edits, validation and logout. API evidence only; no real Phantom, token-balance or transaction coverage.\n');
