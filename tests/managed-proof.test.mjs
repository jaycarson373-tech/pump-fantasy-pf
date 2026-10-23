import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSigner,createTransactionMessage,setTransactionMessageFeePayerSigner,setTransactionMessageLifetimeUsingBlockhash,appendTransactionMessageInstruction,compileTransaction,partiallySignTransaction,getBase64EncodedWireTransaction} from '@solana/kit';
import {assertManagedPayoutProof} from '../lib/server/managed-proof.ts';
test('managed awards preserve the exact reviewed recipient/amount and require the configured wallet proof',async()=>{
  const signer=await generateKeyPairSigner();
  let message=createTransactionMessage({version:0});message=setTransactionMessageFeePayerSigner(signer,message);
  message=setTransactionMessageLifetimeUsingBlockhash({blockhash:'11111111111111111111111111111111',lastValidBlockHeight:1000n},message);
  const data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(1000n,4);
  message=appendTransactionMessageInstruction({programAddress:'11111111111111111111111111111111',data,accounts:[{address:signer.address,role:3},{address:(await generateKeyPairSigner()).address,role:1}]},message);
  const unsigned=compileTransaction(message),wire=getBase64EncodedWireTransaction(unsigned);
  const signed=await partiallySignTransaction([signer.keyPair],unsigned),proof=getBase64EncodedWireTransaction(signed);
  assertManagedPayoutProof(wire,proof,signer.address);
  const changed=Uint8Array.from(signed.messageBytes);changed[changed.length-1]^=1;
  assert.throws(()=>assertManagedPayoutProof(wire,getBase64EncodedWireTransaction({...signed,messageBytes:changed}),signer.address),/changed/);
  assert.throws(()=>assertManagedPayoutProof(wire,getBase64EncodedWireTransaction({...signed,signatures:{[signer.address]:new Uint8Array(64)}}),signer.address),/invalid signature/);
});
