import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){
  if(s==='next/server')return next('next/server.js',c);
  if(s.startsWith('.')&&!/\.[a-z]+$/.test(s)&&existsSync(new URL(s+'.ts',c.parentURL)))return next(s+'.ts',c);
  return next(s,c);
}});
const {retireTestRound}=await import('../lib/server/league/test-round.ts');
const {currentSeason}=await import('../lib/server/league/service.ts');
const {queryRows,closeDatabasePool}=await import('../lib/server/database.ts');
try {
  const before=await queryRows('select * from pfl_rosters where round_id=$1',['test-local-w1']);
  assert.ok(before.length);
  assert.deepEqual(await retireTestRound('test-local'),{id:'test-local',retired:true});
  assert.deepEqual(await retireTestRound('test-local'),{id:'test-local',retired:true});
  assert.equal(await currentSeason(),null);
  const [round]=await queryRows('select status from pfl_rounds where id=$1',['test-local-w1']);
  assert.equal(round.status,'locked');
  assert.deepEqual(await queryRows('select * from pfl_rosters where round_id=$1',['test-local-w1']),before);
  await assert.rejects(()=>retireTestRound('season-1'),/Only a test-/);
  await assert.rejects(()=>retireTestRound('test-missing'),/does not exist/);
  await queryRows("update pfl_seasons set format='starting-seven-v1' where id='test-local'");
  await assert.rejects(()=>retireTestRound('test-local'),/real competition/);
  await queryRows("update pfl_seasons set format='starting-seven-test-v1' where id='test-local'");
  console.log('PASS: test round retired idempotently, real-season refusal, historical entries unchanged, no active test season.');
} finally {await closeDatabasePool();}
