import test from 'node:test';import assert from 'node:assert/strict';
import {priceForRank,restorePicks,serializePicks,rebasePicks} from '../lib/budget-draft.ts';
const players=Array.from({length:50},(_,i)=>({rank:i+1,wallet:'wallet'+(i+1)}));
test('draft prices follow bands and reject non-roster ranks',()=>{assert.equal(priceForRank(1),35);assert.equal(priceForRank(50),6);for(const rank of [0,51,NaN,1.5])assert.throws(()=>priceForRank(rank));});
test('saved picks retain wallet identity when the field changes ranks',()=>{
 const after=players.map(p=>({...p,rank:p.rank===1?2:p.rank===2?1:p.rank}));
 assert.deepEqual(rebasePicks({0:1},players,after),{0:2});
 assert.deepEqual(serializePicks({0:1},players),{'0':'wallet1'});
});
test('roster changes cannot restore a trader from a different rank band',()=>{
 const after=players.map(p=>({...p,rank:p.rank===1?11:p.rank===11?1:p.rank}));
 assert.deepEqual(rebasePicks({0:1},players,after),{});
});
test('tampered local state cannot exceed the salary cap or inject an unknown player',()=>{
 const picks=restorePicks({0:'wallet1',1:'wallet11',2:'wallet21',3:'wallet31',4:'wallet41'},players);
 assert.ok(Object.values(picks).reduce((a,r)=>a+priceForRank(r),0)<=100);
 assert.deepEqual(restorePicks({0:'missing',1:11},players),{});assert.deepEqual(restorePicks([],players),{});
});
