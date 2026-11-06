import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3098';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Lifecycle test is local-only.');
const headers = { 'content-type':'application/json', authorization:`Bearer ${process.env.PF_DATA_INGEST_SECRET}` };
async function request(path,method='GET',body) {
 const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json()};
}
const before=(await request('/api/entry')).body.seasonId;
let opened=false;
try {
 const draft=await request('/api/admin/season/start','POST',{action:'test-open'});
 assert.equal(draft.status,200,JSON.stringify(draft.body));opened=true;
 assert.equal(Date.parse(draft.body.lockedAt)-Date.parse(draft.body.opensAt),3600000);
 const entry=(await request('/api/entry')).body;
 assert.equal(entry.phase,'draft');assert.match(entry.seasonId,/^wallet-test-/);
 const roster=(await request('/api/players')).body;
 assert.equal(roster.players.length,50);assert.equal(roster.seasonId,entry.seasonId);
 assert.ok(roster.players.every(p=>p.id.startsWith(entry.seasonId)));
 const tick=await request('/api/cron/tick','POST',{});
 assert.equal(tick.body.value.action,'idle','Test drafts cannot run rewards or rollover');
 assert.equal((await request('/api/entry','PUT',{picks:roster.players.slice(0,5).map(p=>p.id)})).status,401);
 assert.notEqual((await request('/api/admin/season/start','POST',{action:'test-open'})).status,200);
} finally {
 if(opened) assert.equal((await request('/api/admin/season/start','POST',{action:'test-close'})).status,200);
}
const restored=(await request('/api/entry')).body;
assert.equal(restored.seasonId,before);assert.equal(restored.phase,'inactive');
console.log('PASS: isolated 60-minute draft, 50 persisted players, authentication required, reward worker idle, duplicate open refused, original season restored.');
