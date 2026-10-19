import test from 'node:test';
import assert from 'node:assert/strict';
import {createMainnetVerifier,SOLANA_MAINNET_GENESIS} from '../lib/server/network-identity.ts';
test('a mainnet-looking hostname never authorizes a devnet response',async()=>{
 const verify=createMainnetVerifier(async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
 await assert.rejects(verify('https://mainnet.example/rpc'),/not mainnet/);
});
test('network verification is endpoint-bound and expires after thirty seconds',async()=>{
 let now=0,calls=0;const verify=createMainnetVerifier(async()=>{calls++;return SOLANA_MAINNET_GENESIS},()=>now);
 await verify('https://rpc.example/a');await verify('https://rpc.example/a');assert.equal(calls,1);
 await verify('https://rpc.example/b');assert.equal(calls,2);now=30001;
 await verify('https://rpc.example/b');assert.equal(calls,3);
});
test('failed or unavailable network checks are never cached as success',async()=>{
 let calls=0;const verify=createMainnetVerifier(async()=>{if(++calls===1)throw Error('offline');return SOLANA_MAINNET_GENESIS});
 await assert.rejects(verify('https://rpc.example'),/offline/);await verify('https://rpc.example');assert.equal(calls,2);
});
test('missing and insecure RPC settings fail before reading the chain',async()=>{
 const verify=createMainnetVerifier(async()=>{throw Error('should not read')});
 await assert.rejects(verify(undefined),/not configured/);await assert.rejects(verify('http://rpc.example'),/HTTPS/);
});
