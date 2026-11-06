import test from 'node:test';
import assert from 'node:assert/strict';
import {address,getAddressEncoder,pipe,createTransactionMessage,setTransactionMessageFeePayer,setTransactionMessageLifetimeUsingBlockhash,appendTransactionMessageInstructions,compileTransaction,getBase64EncodedWireTransaction} from '@solana/kit';
import {creatorAddresses,directCollectionInstructions,assertDirectSolCreator,assertFinalizedWire,PUMP,AMM,WSOL,TOKEN} from '../lib/server/creator-protocol.mjs';
import schemas from '../lib/server/protocol/creator-fees.json' with {type:'json'};
// Public mainnet mint fixture, finalized slot466238038, fetched2026-11-06.
const PUMP_MINT_ACCOUNT={"owner": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "data": ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALUDibTVxbwsGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ4AQAC3lMVNLXVgZz3rXJPfO/JJlboUKTQHyWPvpdl+vE+u3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEgBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADEX3342ecpVihJM/bZi3VwMug9+EYE+14Rf/9h1bEvkTAKgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMRfffjZ5ylWKEkz9tmLdXAy6D34RgT7XhF//2HVsS+QQAAABQdW1wBAAAAFBVTVBQAAAAaHR0cHM6Ly9pcGZzLmlvL2lwZnMvYmFma3JlaWJjZ2xsZGtmZGVrZGt4Z3VtbHZlb2U2cXYzcGJpY2V5cGt3dGxpMzNjbGJ6dWw3bGVvNG0AAAAA", "base64"]};
const TOKEN2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const wallet='9xQeWvG816bUx9EPfEZTh2dpX1boA9E3B9Lm7bJiGx3F',other='So11111111111111111111111111111111111111112';
test('current pinned fee instructions bind both protocol vaults to the sole creator',async()=>{
 const a=await creatorAddresses(wallet),ix=await directCollectionInstructions(wallet);
 assert.notEqual(a.solVault,a.ammAuthority);assert.equal(ix.length,4);
 assert.equal(ix[1].programAddress,PUMP);assert.equal(ix[2].programAddress,AMM);
 assert.deepEqual([...ix[1].data],schemas[0].instruction.discriminator);
 assert.deepEqual([...ix[2].data],schemas[1].instruction.discriminator);
 for(const i of ix)for(const k of i.accounts)if(k.role>=2)assert.equal(k.address,wallet);
 const msg=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayer(address(wallet),m),m=>setTransactionMessageLifetimeUsingBlockhash({blockhash:address(other),lastValidBlockHeight:100n},m),m=>appendTransactionMessageInstructions(ix,m));
 assert.ok(Buffer.from(getBase64EncodedWireTransaction(compileTransaction(msg)),'base64').length<=1232);
 assert.equal((await directCollectionInstructions(wallet,{curve:true,amm:false})).length,1);
});
test('direct collection rejects sharing-config creators and non-SOL quotes',()=>{
 const data=Buffer.alloc(115);Buffer.from(schemas[0].curve_discriminator).copy(data);Buffer.from(getAddressEncoder().encode(address(wallet))).copy(data,49);Buffer.from(getAddressEncoder().encode(address(WSOL))).copy(data,83);
 const account=()=>({owner:PUMP,data:[data.toString('base64'),'base64']});
 assert.doesNotThrow(()=>assertDirectSolCreator(account(),wallet));
 assert.throws(()=>assertDirectSolCreator(account(),other),/Creator wallet/);
 data.fill(1,83,115);assert.throws(()=>assertDirectSolCreator(account(),wallet),/SOL-quoted/);
});
test('a finalized receipt must contain the exact persisted bytes and successful metadata',()=>{
 const wire=Buffer.from('reviewed wire').toString('base64');
 assert.doesNotThrow(()=>assertFinalizedWire(wire,{meta:{err:null},transaction:[wire,'base64']}));
 assert.throws(()=>assertFinalizedWire(wire,{meta:{err:null},transaction:['tampered','base64']}));
 assert.throws(()=>assertFinalizedWire(wire,{meta:{err:{}},transaction:[wire,'base64']}));
});

test('PUMP quote binds mint, decimals, direct creator and supported fee mode', async()=>{
 const {assertDirectCreator,assertQuoteMint,PUMP_MINT}=await import('../lib/server/creator-protocol.mjs');
 const data=Buffer.alloc(133);Buffer.from(schemas[0].curve_discriminator).copy(data);Buffer.from(getAddressEncoder().encode(address(wallet))).copy(data,49);Buffer.from(getAddressEncoder().encode(address(PUMP_MINT))).copy(data,83);data.writeBigUInt64LE(17n,125);
 const account=()=>({owner:PUMP,data:[data.toString('base64'),'base64']});
 assert.equal(assertDirectCreator(account(),wallet,PUMP_MINT).waiting,17n);
 assert.throws(()=>assertDirectCreator(account(),wallet,WSOL),/quote/);
 for(const offset of [82,124]){data[offset]=1;assert.throws(()=>assertDirectCreator(account(),wallet,PUMP_MINT),/fee mode/);data[offset]=0;}
 const mintData=Buffer.from(PUMP_MINT_ACCOUNT.data[0],'base64');
 const mintAccount=()=>({owner:TOKEN2022,data:[mintData.toString('base64'),'base64']});
 assert.doesNotThrow(()=>assertQuoteMint(mintAccount(),6));mintData[44]=9;assert.throws(()=>assertQuoteMint(mintAccount(),6),/mint/);
 assert.throws(()=>assertQuoteMint({...mintAccount(),owner:PUMP},6),/mint/);
});

test('PUMP collection uses donor sweep and v2 collect without WSOL closure',async()=>{
 const {quoteCollectionInstructions,quoteCollectionAddresses,PUMP_MINT,ATA}=await import('../lib/server/creator-protocol.mjs');
 const {createHash}=await import('node:crypto');
 const a=await quoteCollectionAddresses(wallet,other,PUMP_MINT);
 // Independently derived with the donor's legacy PublicKey PDA implementation.
 assert.equal(a.pool,'HDZrPJ3sGHj4BYd4gMQdQAXs32m98Lm5GsF3sLD4QVNv');
 assert.equal(a.creatorATA,'CGcLpFqAZqFqdVHXpcx92wL6cT67ZXt7bd8UcpoBKgdw');
 const ix=await quoteCollectionInstructions(wallet,other,PUMP_MINT,{pool:true});
 assert.equal(ix.length,5);assert.equal(ix[0].programAddress,ATA);assert.equal(ix[0].accounts[5].address,TOKEN2022);
 const names=['sweep_creator_fee','sweep_creator_fee','transfer_creator_fees_to_pump_v2','collect_creator_fee_v2'];
 for(let i=1;i<ix.length;i++)assert.deepEqual(Buffer.from(ix[i].data),createHash('sha256').update('global:'+names[i-1]).digest().subarray(0,8));
 assert.deepEqual(ix[1].accounts.map(k=>k.address),[wallet,a.global,other,PUMP_MINT,TOKEN2022,ATA,'11111111111111111111111111111111',a.curve,a.curveATA,a.solVault,a.solVaultATA,a.event,PUMP]);
 assert.deepEqual(ix[2].accounts.map(k=>k.address),[wallet,a.globalConfig,a.pool,PUMP_MINT,TOKEN2022,a.poolATA,a.ammAuthority,a.ammATA,'11111111111111111111111111111111',ATA,a.ammEvent,AMM]);
 assert.deepEqual(ix[3].accounts.map(k=>k.address),[wallet,PUMP_MINT,TOKEN2022,'11111111111111111111111111111111',ATA,wallet,a.ammAuthority,a.ammATA,a.solVault,a.solVaultATA,a.ammEvent,AMM]);
 const roles=[[3,0,0,0,0,0,0,1,1,1,1,0,0],[3,0,1,0,0,1,0,1,0,0,0,0],[3,0,0,0,0,0,1,1,1,1,0,0],[1,1,1,1,0,0,0,0,0,0]];
 for(let i=1;i<ix.length;i++)assert.deepEqual(ix[i].accounts.map(k=>k.role),roles[i-1]);
 assert.deepEqual(ix[4].accounts.map(k=>k.address),[wallet,a.creatorATA,a.solVault,a.solVaultATA,PUMP_MINT,TOKEN2022,ATA,'11111111111111111111111111111111',a.event,PUMP]);
 assert.equal(ix[4].accounts[0].role,1);assert.notEqual(a.creatorATA,(await creatorAddresses(wallet)).creatorATA);
 assert.equal((await quoteCollectionInstructions(wallet,other,PUMP_MINT)).length,3);
 const msg=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayer(address(wallet),m),m=>setTransactionMessageLifetimeUsingBlockhash({blockhash:address(other),lastValidBlockHeight:100n},m),m=>appendTransactionMessageInstructions(ix,m));
 assert.ok(Buffer.from(getBase64EncodedWireTransaction(compileTransaction(msg)),'base64').length<=1232);
});

test('graduated pool validation binds base mint, quote, creator, pool ATA and fee mode',async()=>{
 const {assertQuotePool,quoteCollectionAddresses,PUMP_MINT}=await import('../lib/server/creator-protocol.mjs');
 const a=await quoteCollectionAddresses(wallet,other,PUMP_MINT),data=Buffer.alloc(287);
 Buffer.from([241,154,109,4,17,177,109,188]).copy(data);
 const put=(key,offset)=>Buffer.from(getAddressEncoder().encode(address(key))).copy(data,offset);
 put(other,43);put(PUMP_MINT,75);put(a.poolATA,171);put(wallet,211);data.writeBigUInt64LE(9n,279);
 const account=()=>({owner:AMM,data:[data.toString('base64'),'base64']});
 assert.equal(assertQuotePool(account(),other,wallet,PUMP_MINT,a.poolATA).waiting,9n);
 for(const offset of [43,75,171,211]){const old=Buffer.from(data);put(PUMP,offset);assert.throws(()=>assertQuotePool(account(),other,wallet,PUMP_MINT,a.poolATA),/pool/);old.copy(data);}
 for(const offset of [244,270]){data[offset]=1;assert.throws(()=>assertQuotePool(account(),other,wallet,PUMP_MINT,a.poolATA),/fee mode/);data[offset]=0;}
});

test('actual Token2022 PUMP mint permits only metadata and a dormant transfer hook',async()=>{
 const {assertQuoteMint}=await import('../lib/server/creator-protocol.mjs');
 assert.doesNotThrow(()=>assertQuoteMint(PUMP_MINT_ACCOUNT,6));
 const changed=mutate=>{const data=Buffer.from(PUMP_MINT_ACCOUNT.data[0],'base64');mutate(data);return {owner:TOKEN2022,data:[data.toString('base64'),'base64']};};
 assert.throws(()=>assertQuoteMint(changed(data=>{data[202]=1}),6),/hook/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data.writeUInt16LE(1,166)}),6),/extension/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data.writeUInt16LE(12,166)}),6),/extension/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data[165]=2}),6),/mint/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data[100]=1}),6),/mint/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data.writeUInt16LE(65535,168)}),6),/extension/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data.writeUInt16LE(14,234)}),6),/extension/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data[270]^=1}),6),/extension/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data[338]^=1}),6),/extension/);
 assert.throws(()=>assertQuoteMint(changed(data=>{data[45]=0}),6),/mint/);
 const truncated=Buffer.from(PUMP_MINT_ACCOUNT.data[0],'base64').subarray(0,473);
 assert.throws(()=>assertQuoteMint({owner:TOKEN2022,data:[truncated.toString('base64'),'base64']},6),/extension/);
 assert.throws(()=>assertQuoteMint({...PUMP_MINT_ACCOUNT,owner:TOKEN},6),/mint/);
});
