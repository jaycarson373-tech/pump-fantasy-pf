import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === '../reward-asset' ? '../reward-asset.ts' : specifier, context);
} });
const { tokenPaymentInstructions, matchesTokenPayment } = await import('../lib/server/token-payment.ts');

const source = '11111111111111111111111111111111';
const winner = 'So11111111111111111111111111111111111111112';
const mint = 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn';
const token = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

test('PUMP payout creates recipient ATA and transfers exact six-decimal raw units', async () => {
  const instructions = await tokenPaymentInstructions(source, winner, '1000001', 'PUMP');
  assert.equal(instructions.length, 2);
  assert.equal(instructions[0].programAddress, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  assert.deepEqual([...instructions[0].data], [1]);
  assert.equal(instructions[1].programAddress, token);
  assert.equal(instructions[1].accounts[1].address, mint);
  assert.equal(instructions[1].accounts[3].address, source);
  assert.deepEqual([...instructions[1].data], [12,65,66,15,0,0,0,0,0,6]);
  await assert.rejects(tokenPaymentInstructions(source,winner,'0','PUMP'));
});

async function fixture() {
  const [,transfer] = await tokenPaymentInstructions(source,winner,'1000001','PUMP');
  const from=transfer.accounts[0].address,to=transfer.accounts[2].address;
  const balance=(accountIndex,owner,amount)=>({accountIndex,mint,owner,uiTokenAmount:{amount,decimals:6}});
  return { slot:123,blockTime:456,meta:{err:null,preTokenBalances:[balance(1,source,'2000000')],postTokenBalances:[balance(1,source,'999999'),balance(2,winner,'1000001')]},transaction:{message:{accountKeys:[{pubkey:source,signer:true},{pubkey:from},{pubkey:to}],instructions:[{programId:token,parsed:{type:'transferChecked',info:{source:from,destination:to,authority:source,mint,tokenAmount:{amount:'1000001',decimals:6}}}}]}}};
}
test('receipt matches exact asset, signer, recipient and balance movement', async()=>{
  const tx=await fixture();
  assert.equal(await matchesTokenPayment(tx,source,winner,'1000001','PUMP'),true);
  for(const field of ['mint','source','destination','authority']){
    const bad=structuredClone(tx);bad.transaction.message.instructions[0].parsed.info[field]=winner;
    assert.equal(await matchesTokenPayment(bad,source,winner,'1000001','PUMP'),false);
  }
  for(const amount of ['1000000','1000002']) assert.equal(await matchesTokenPayment(tx,source,winner,amount,'PUMP'),false);
  const unsigned=structuredClone(tx);unsigned.transaction.message.accountKeys[0].signer=false;
  assert.equal(await matchesTokenPayment(unsigned,source,winner,'1000001','PUMP'),false);
  const diverted=structuredClone(tx);diverted.meta.postTokenBalances[1].uiTokenAmount.amount='1';
  assert.equal(await matchesTokenPayment(diverted,source,winner,'1000001','PUMP'),false);
  const wrongDecimals=structuredClone(tx);wrongDecimals.transaction.message.instructions[0].parsed.info.tokenAmount.decimals=9;
  assert.equal(await matchesTokenPayment(wrongDecimals,source,winner,'1000001','PUMP'),false);
});
