// Real durable registration and Solana encoding; mock only remote Pump/RPC transports.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {generateKeyPairSync,sign} from 'node:crypto';
import {getAddressDecoder,getBase58Decoder,getTransactionDecoder,getTransactionEncoder,address} from '@solana/kit';
import pg from 'pg';
const root=await mkdtemp(join(tmpdir(),'pf-registration-pg-'));
const bin='/opt/homebrew/opt/postgresql@16/bin',port=56187;
const run=(name,args)=>{const r=spawnSync(join(bin,name),args,{encoding:'utf8'});assert.equal(r.status,0,`${name}: ${r.stderr}`)};
const base=new URL('../lib/',import.meta.url).href;
registerHooks({resolve(s,c,n){return n(c.parentURL?.startsWith(base)&&s.startsWith('.')&&!/\.[a-z]+$/.test(s)?s+'.ts':s,c)}});
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const wallet=getAddressDecoder().decode(publicKey.export({type:'spki',format:'der'}).subarray(-32));
const key=n=>getBase58Decoder().decode(new Uint8Array(32).fill(n));
const mint=key(2),source=key(3),hash=key(4),program='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
process.env.DATABASE_URL=`postgresql://postgres@localhost:${port}/postgres?host=${encodeURIComponent(root)}`;
process.env.PGSSLMODE='disable';process.env.SOLANA_RPC_URL='https://offline-rpc.invalid';process.env.FANTASY_MINT_ADDRESS=mint;
let started=false,sql,closeDatabasePool,upstream403=true,tx=null,broadcasts=0;
const response=data=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:data}));
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url);
 if(u.hostname==='frontend-api-v3.pump.fun'){
  if(upstream403)return new Response('blocked',{status:403});
  if(u.pathname.startsWith('/users/'))return new Response(JSON.stringify({address:wallet,canonical_svm_wallet:wallet,username:'Offline player',is_pump_user:true,kind:'person',profile_image:null}));
  assert.equal(u.pathname,'/portfolio-summary');assert.equal(u.searchParams.get('period'),'all');
  return new Response(JSON.stringify({wallet,pnl:{usd:120},computedAt:Date.now(),missingPriceMints:[]}));
 }
 assert.equal(u.hostname,'offline-rpc.invalid');
 const {method,params}=JSON.parse(options.body);
 const amounts={decimals:6,amount:'1000000000000'};
 const replies={getGenesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',getAccountInfo:{value:{owner:program,executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:6}}}}},getTokenAccountsByOwner:{value:[{pubkey:source,account:{owner:program,executable:false,data:{parsed:{type:'account',info:{owner:wallet,mint,state:'initialized',isNative:false,tokenAmount:amounts}}}}}]},getLatestBlockhash:{value:{blockhash:hash,lastValidBlockHeight:100}},isBlockhashValid:{value:true},getBlockHeight:500,getTransaction:tx};
 if(method==='sendTransaction'){broadcasts++;assert.ok(params[0]);return response('sent')}
 assert.ok(Object.hasOwn(replies,method),method);return response(replies[method]);
};
try{
 run('initdb',['-D',join(root,'data'),'-A','trust','-U','postgres','--no-locale']);
 run('pg_ctl',['-D',join(root,'data'),'-l',join(root,'server.log'),'-o',`-k ${root} -p ${port} -h ''`,'-w','start']);started=true;
 sql=new pg.Client({host:root,port,database:'postgres',user:'postgres'});await sql.connect();
 await sql.query(await readFile('db/migrations/202611060004_community_players.sql','utf8'));
 const api=await import('../lib/server/community-player.ts');
 ({closeDatabasePool}=await import('../lib/server/database.ts'));
 await assert.rejects(api.prepareCommunityPlayer(wallet),/unavailable/);
 assert.equal((await sql.query('select count(*)::int n from pf_player_burns')).rows[0].n,0,'403 must create no burn');assert.equal(broadcasts,0);
 upstream403=false;
 await sql.query("update pf_community_source_budget set next_call='-infinity'");
 const quote=await api.prepareCommunityPlayer(wallet);
 assert.equal(quote.amount,'500000');
 await assert.rejects(api.submitCommunityBurn(key(9),quote.id,'bad'),/not found/);
 await assert.rejects(api.submitCommunityBurn(wallet,quote.id,quote.prepared.transaction),/no signature/);
 const decoded=getTransactionDecoder().decode(Buffer.from(quote.prepared.transaction,'base64'));
 const signed={...decoded,signatures:{[address(wallet)]:new Uint8Array(sign(null,Buffer.from(decoded.messageBytes),privateKey))}};
 const wire=Buffer.from(getTransactionEncoder().encode(signed)).toString('base64');
 await sql.query("update pf_community_source_budget set next_call='-infinity'");
 const pending=await api.submitCommunityBurn(wallet,quote.id,wire);
 assert.equal(broadcasts,1);assert.ok(pending.pending.signature);
 await assert.rejects(api.prepareCommunityPlayer(wallet),/receipt/);
 assert.ok((await api.confirmCommunityBurn(wallet,quote.id)).pending,'unknown history stays pending even after lifetime expiry');
 assert.equal((await sql.query('select count(*)::int n from pf_player_burns')).rows[0].n,1,'expired/null history must never discard a potentially successful burn');
 const {intent}= (await sql.query('select intent from pf_player_burns')).rows[0];
 const balance=amount=>[{accountIndex:1,owner:wallet,mint,programId:program,uiTokenAmount:{amount,decimals:6}}];
 tx={version:'legacy',slot:10,blockTime:Math.floor(Date.now()/1000),transaction:{signatures:[pending.pending.signature],message:{accountKeys:[{pubkey:wallet,signer:true,writable:true},{pubkey:source,signer:false,writable:true}],instructions:[{programId:program,parsed:{type:'burnChecked',info:{mint,account:source,authority:wallet,tokenAmount:{amount:intent.amount,decimals:6}}}},{programId:'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',parsed:intent.memo}]}},meta:{err:null,innerInstructions:[],preTokenBalances:balance('1000000000000'),postTokenBalances:balance('500000000000')}};
 const successful=structuredClone(tx);
 tx.meta.err=false;
 await assert.rejects(api.confirmCommunityBurn(wallet,quote.id),/incomplete/);
 assert.equal((await sql.query('select count(*)::int n from pf_player_burns')).rows[0].n,1,'malformed failure is unknown, not reset permission');
 tx=successful;
 const wrong=structuredClone(tx);wrong.transaction.message.instructions[0].parsed.info.tokenAmount.amount='1';tx=wrong;
 await assert.rejects(api.confirmCommunityBurn(wallet,quote.id),/does not prove/);
 assert.equal((await sql.query('select count(*)::int n from pf_community_players')).rows[0].n,0);
 tx.transaction.message.instructions[0].parsed.info.tokenAmount.amount=intent.amount;
 await closeDatabasePool();
 assert.equal((await api.confirmCommunityBurn(wallet,quote.id)).player.display_name,'Offline player','restart can recover finalized proof');
 await api.confirmCommunityBurn(wallet,quote.id);
 assert.equal((await sql.query('select count(*)::int n from pf_community_players')).rows[0].n,1);
 await assert.rejects(api.prepareCommunityPlayer(wallet),/already registered/);
 assert.equal(broadcasts,1);
 console.log('PASS: real PG registration, 403 no-burn, exact signed Token-2022 transaction, foreign-wallet and unsigned rejection, pending/restart recovery, malformed proof refusal, single permanent registration/replay. External services mocked; no live burn.');
}finally{
 globalThis.fetch=originalFetch;
 if(closeDatabasePool)await closeDatabasePool();if(sql)await sql.end();
 if(started)run('pg_ctl',['-D',join(root,'data'),'-m','immediate','-w','stop']);
 await rm(root,{recursive:true,force:true});
}
