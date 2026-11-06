import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { getBase58Decoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
const base=new URL('../lib/',import.meta.url).href;
registerHooks({resolve(s,c,n){return n(c.parentURL?.startsWith(base)&&s.startsWith('.')&&!/\.[a-z]+$/.test(s)?s+'.ts':s,c)}});
const {buildBurnTransaction,signedBurn}=await import('../lib/community-burn/transaction.ts');
const {verifyBurnProof}=await import('../lib/community-burn/proof.ts');
const {TOKEN_PROGRAMS,MEMO_PROGRAM}=await import('../lib/community-burn/types.ts');
const key=n=>getBase58Decoder().decode(new Uint8Array(32).fill(n));
const signature=getBase58Decoder().decode(new Uint8Array(64).fill(5));
const intent={id:'fixture',wallet:key(1),mint:key(2),source:key(3),tokenProgram:TOKEN_PROGRAMS[1],amount:'500000000000',decimals:6,memo:'pfl:create-player:fixture',created:100};
function proof(){const balance=amount=>[{accountIndex:1,owner:intent.wallet,mint:intent.mint,programId:intent.tokenProgram,uiTokenAmount:{amount,decimals:6}}];return {version:'legacy',slot:10,blockTime:110,transaction:{signatures:[signature],message:{accountKeys:[{pubkey:intent.wallet,signer:true,writable:true},{pubkey:intent.source,signer:false,writable:true}],instructions:[{programId:intent.tokenProgram,parsed:{type:'burnChecked',info:{mint:intent.mint,account:intent.source,authority:intent.wallet,tokenAmount:{amount:intent.amount,decimals:6}}}},{programId:MEMO_PROGRAM,parsed:intent.memo}]}},meta:{err:null,innerInstructions:[],preTokenBalances:balance('600000000000'),postTokenBalances:balance('100000000000')}}}
test('Token-2022 exact burn wire encodes 500k units and bound memo',()=>{
 const prepared=buildBurnTransaction(intent,key(9),200);
 const tx=getTransactionDecoder().decode(Buffer.from(prepared.transaction,'base64'));
 const msg=getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
 const ix=msg.instructions.find(i=>msg.staticAccounts[i.programAddressIndex]===intent.tokenProgram);
 assert.equal(ix.data[0],15);assert.equal(Buffer.from(ix.data).readBigUInt64LE(1),500000000000n);assert.equal(ix.data[9],6);
 assert.throws(()=>signedBurn(prepared,prepared.transaction,intent.wallet),/no signature/);
});
test('finalized burn proof binds identity, mint, amount, receipt and memo',()=>{
 assert.equal(verifyBurnProof(proof(),signature,intent).slot,10);
 for(const patch of [{wallet:key(8)},{mint:key(8)},{amount:'1'},{memo:'other'},{source:key(8)},{tokenProgram:TOKEN_PROGRAMS[0]}]) assert.throws(()=>verifyBurnProof(proof(),signature,{...intent,...patch}));
 assert.throws(()=>verifyBurnProof(proof(),'different',intent));
});
test('failed, stale, transferred or extra-effect receipts cannot register a player',()=>{
 for(const mutate of [p=>p.meta.err={},p=>p.blockTime=1,p=>p.meta.postTokenBalances[0].uiTokenAmount.amount='599999999999',p=>p.transaction.message.instructions.push({programId:key(7)}),p=>p.meta.innerInstructions=[{index:1}]]){const p=proof();mutate(p);assert.throws(()=>verifyBurnProof(p,signature,intent));}
});
