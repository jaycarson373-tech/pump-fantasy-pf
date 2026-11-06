import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){
  if(s==='next/server')return next('next/server.js',c);
  if(s==='server-only')return {url:'data:text/javascript,export {}',shortCircuit:true};
  if(s.startsWith('.')&&!/\.[a-z]+$/.test(s)&&existsSync(new URL(s+'.ts',c.parentURL)))return next(s+'.ts',c);
  return next(s,c);
}});
const {POST}=await import('../app/api/league/admin/route.ts');
test('authenticated old test-opening action is removed',async()=>{
  const previous=process.env.PF_DATA_INGEST_SECRET;
  process.env.PF_DATA_INGEST_SECRET='local-unit-admin-secret';
  try {
    const response=await POST(new Request('https://example.invalid/api/league/admin',{method:'POST',headers:{authorization:'Bearer local-unit-admin-secret','content-type':'application/json'},body:JSON.stringify({action:'open-test-round',id:'test-must-not-open'})}));
    assert.equal(response.status,400);
    assert.equal((await response.json()).error,'Unknown action');
  } finally {
    if(previous===undefined)delete process.env.PF_DATA_INGEST_SECRET;
    else process.env.PF_DATA_INGEST_SECRET=previous;
  }
});
