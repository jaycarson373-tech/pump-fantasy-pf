import test from 'node:test';
import assert from 'node:assert/strict';
import {address,getAddressEncoder,pipe,createTransactionMessage,setTransactionMessageFeePayer,setTransactionMessageLifetimeUsingBlockhash,appendTransactionMessageInstructions,compileTransaction,getBase64EncodedWireTransaction} from '@solana/kit';
import {creatorAddresses,directCollectionInstructions,assertDirectSolCreator,assertFinalizedWire,PUMP,AMM,WSOL} from '../lib/server/creator-protocol.mjs';
import schemas from '../lib/server/protocol/creator-fees.json' with {type:'json'};
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
