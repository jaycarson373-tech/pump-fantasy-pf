/** Loopback-only fixture gateway for browser interaction tests. Never deploy. */
import http from 'node:http';
import {Readable} from 'node:stream';
const upstream='http://127.0.0.1:52863';
const players=Array.from({length:100},(_,i)=>({id:`qa-${i+1}`,wallet:'1'.repeat(31)+String(i+100),rank:i+1,name:`QA Fixture ${i+1}`,avatar:null,pnlMicros:String((100-i)*100000000),roiBps:i%2?null:1000,trades:50+i,sourceUrl:'https://example.org/local-test-fixture'}));
const server=http.createServer(async(req,res)=>{
 try{
 if(req.method!=='GET'){res.writeHead(405);res.end('Read-only QA: no transactions or submissions');return;}
 if(req.url?.startsWith('/api/league')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ready',serverTime:new Date().toISOString(),season:{title:'LOCAL QA FIXTURE — NOT LIVE',number:999,weeks:4,status:'active'},round:{id:'qa-only',week:1,status:'open',opens_at:new Date(Date.now()-86400000).toISOString(),locks_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+8*86400000).toISOString(),pool_hash:'test-only',pool_source:'https://example.org/local-test-fixture',pool_observed_at:new Date().toISOString()},players,roster:null,boards:{daily:[],weekly:[],season:[]},scoringDays:[],champions:[]}));return;}
 const r=await fetch(upstream+req.url,{headers:{Accept:req.headers.accept??'*/*'}});res.statusCode=r.status;for(const h of ['content-type','cache-control'])if(r.headers.get(h))res.setHeader(h,r.headers.get(h));if(r.body)Readable.fromWeb(r.body).pipe(res);else res.end();
 }catch{res.writeHead(502);res.end('Start the local production build on 52863 first');}
});
server.listen(52864,'127.0.0.1',()=>console.log('LOCAL TEST DATA ONLY: http://127.0.0.1:52864/draft'));
