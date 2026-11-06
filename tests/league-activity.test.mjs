import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDraftEvents, formatPaid } from '../lib/league/activity.ts';
const event=(id,time)=>({id,wallet:'public-wallet',week:1,submittedAt:new Date(time).toISOString()});
test('entry notifications ignore known edits, historical events and future timestamps',()=>{
 const events=[event('known',1500),event('old',500),event('new',2000),event('future',4000)];
 assert.deepEqual(freshDraftEvents(events,new Set(['known']),1000,3000).map(e=>e.id),['new']);
});
test('one wallet can enter another week but a repeat poll cannot replay its entry',()=>{
 const events=[event('w1:wallet',2000),event('w2:wallet',3000)];
 assert.deepEqual(freshDraftEvents(events,new Set(['w1:wallet']),1000,4000).map(e=>e.id),['w2:wallet']);
 assert.deepEqual(freshDraftEvents(events,new Set(events.map(e=>e.id)),1000,4000),[]);
});
test('stale arrivals are not announced as new and queued entries are chronological',()=>{
 assert.deepEqual(freshDraftEvents([event('stale',1000),event('b',130001),event('a',130000)],new Set(),0,140000).map(e=>e.id),['a','b']);
});
test('confirmed payout display preserves integer precision and never guesses decimals',()=>{
 assert.equal(formatPaid('123456789012345678901',6),'123,456,789,012,345.6789');
 assert.equal(formatPaid('1234',null),'—');
 assert.equal(formatPaid('0',null),'0');
 assert.equal(formatPaid('1',9),'<0.0001');
 assert.equal(formatPaid('1000000',6),'1');
 assert.equal(formatPaid('-1',6),'—');
});
