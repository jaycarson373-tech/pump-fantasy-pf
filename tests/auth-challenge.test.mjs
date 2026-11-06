import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';

const route=new URL('../app/api/auth/challenge/route.ts',import.meta.url).href;
const saved=[];
globalThis.challengeRows=async (...args)=>{saved.push(args);return [];};
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===route&&specifier==='node:crypto')
  return {url:'data:text/javascript,export const randomBytes=()=>({toString:encoding=>encoding===\'hex\'?\'ff\'.repeat(24):\'_\'.repeat(32)});',shortCircuit:true};
 if(context.parentURL===route&&specifier.endsWith('/config'))
  return {url:'data:text/javascript,export const getBackendConfig=()=>({ready:true});',shortCircuit:true};
 if(specifier.endsWith('/database'))
  return {url:'data:text/javascript,export const queryRows=(...args)=>globalThis.challengeRows(...args);',shortCircuit:true};
 if(specifier==='server-only')return {url:'data:text/javascript,export {}',shortCircuit:true};
 if(specifier==='next/server')return next('next/server.js',context);
 if(specifier.startsWith('.')&&!/\.[a-z]+$/.test(specifier)&&existsSync(new URL(specifier+'.ts',context.parentURL)))return next(specifier+'.ts',context);
 return next(specifier,context);
}});
const {POST}=await import(route);
const wallet='11111111111111111111111111111111';
test('challenge uses structured wallet sign-in grammar and an alphanumeric nonce',async()=>{
 const response=await POST(new Request('https://pfleague.fun/api/auth/challenge',{
  method:'POST',headers:{origin:'https://pfleague.fun','content-type':'application/json'},body:JSON.stringify({wallet}),
 }));
 assert.equal(response.status,200);
 const {message}=await response.json();
 assert.match(message,/^pfleague\.fun wants you to sign in with your Solana account:\n11111111111111111111111111111111\n\n/);
 assert.match(message,/\n\nURI: https:\/\/pfleague\.fun\nVersion: 1\nChain ID: solana:mainnet\nNonce: [A-Za-z0-9]{8,}\nIssued At: [^\n]+\nExpiration Time: [^\n]+$/);
 const nonce=message.match(/^Nonce: (.+)$/m)[1];
 assert.equal(saved.at(-1)[1][1],nonce);
 const issued=Date.parse(message.match(/^Issued At: (.+)$/m)[1]);
 const expiry=Date.parse(message.match(/^Expiration Time: (.+)$/m)[1]);
 assert.equal(expiry-issued,300000);
});
