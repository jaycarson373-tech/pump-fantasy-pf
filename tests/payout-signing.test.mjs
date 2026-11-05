import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { address, createTransactionMessage, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, compileTransaction, getBase64EncodedWireTransaction, getTransactionDecoder } from '@solana/kit';
import { readPayoutSigner, signPayoutTransaction } from '../lib/server/payout-signing.ts';

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return JSON.stringify([...seed, ...pub]);
}
function unsigned(wallet) {
  let message = createTransactionMessage({ version: 0 });
  message = setTransactionMessageFeePayer(wallet, message);
  message = setTransactionMessageLifetimeUsingBlockhash({ blockhash: address('11111111111111111111111111111111'), lastValidBlockHeight: 100n }, message);
  return getBase64EncodedWireTransaction(compileTransaction(message));
}
test('local signer preserves transaction bytes and produces a verified wallet signature', async () => {
  const signer = await readPayoutSigner(keyMaterial());
  const wire = unsigned(signer.address);
  const signed = await signPayoutTransaction(wire, signer);
  const decode = getTransactionDecoder();
  assert.deepEqual(decode.decode(Buffer.from(signed, 'base64')).messageBytes, decode.decode(Buffer.from(wire, 'base64')).messageBytes);
  assert.equal(decode.decode(Buffer.from(signed, 'base64')).signatures[signer.address].length, 64);
});
test('invalid key material fails without exposing its contents', async () => {
  for (const value of ['secret-value', '{}', '[]', JSON.stringify(Array(64).fill(256)), JSON.stringify(Array(64).fill(1.5)), JSON.stringify(Array(64).fill(0))]) {
    await assert.rejects(readPayoutSigner(value), error => error.message === 'Invalid payout keypair. Configure a valid 64-byte Solana JSON keypair.');
  }
});
test('keypair must match the configured prize wallet', async () => {
  await assert.rejects(readPayoutSigner(keyMaterial(), '11111111111111111111111111111111'), /does not match/);
});
test('signer refuses a transaction belonging to another wallet', async () => {
  const signer = await readPayoutSigner(keyMaterial());
  await assert.rejects(signPayoutTransaction(unsigned(address('11111111111111111111111111111111')), signer), /sole required signer/);
});
