import test from 'node:test';
import assert from 'node:assert/strict';
import { readLeagueSnapshot } from '../lib/league-refresh.mjs';
test('a roster provider failure cannot hide confirmed awards',async()=>{
  const snapshot=await readLeagueSnapshot({fetcher:async(path)=>{
    if(path.endsWith('players'))throw Error('provider offline');
    return {ok:true,json:async()=>({awards:[{id:'finalized-award'}]})};
  }});
  assert.equal(snapshot.players,null);assert.equal(snapshot.standings.awards[0].id,'finalized-award');assert.equal(snapshot.partial,true);
});
test('an HTTP failure is not accepted as a new season field',async()=>{
  const snapshot=await readLeagueSnapshot({fetcher:async(path)=>({ok:!path.endsWith('players'),json:async()=>({players:Array(50).fill({}),standings:[]})})});
  assert.equal(snapshot.players,null);assert.deepEqual(snapshot.standings.standings,[]);
});
