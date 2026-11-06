import test from 'node:test';
import assert from 'node:assert/strict';
import { walletNetwork } from '../lib/wallet-network.ts';

test('wallet defaults to mainnet and explicit devnet uses matching discovery and RPC', () => {
  assert.deepEqual(walletNetwork(), { chain: 'solana:mainnet', rpcUrl: 'https://api.mainnet-beta.solana.com' });
  assert.deepEqual(walletNetwork('devnet'), { chain: 'solana:devnet', rpcUrl: 'https://api.devnet.solana.com' });
});

test('misspelled wallet network cannot silently select mainnet', () => {
  assert.throws(() => walletNetwork('devnett'), /mainnet or devnet/);
});
