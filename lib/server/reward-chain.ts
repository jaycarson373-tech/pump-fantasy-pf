import 'server-only';
import { assetDetails, type RewardAsset } from '../reward-asset';
import { rpc, getNativeSolBalance, verifyMainnetRpc, verifyNativeSolTransfer } from './solana';
import { assertQuoteMint } from './creator-protocol.mjs';
import { matchesTokenPayment, rewardTokenAccount, type TokenPaymentReceipt } from './token-payment';

type ParsedTokenAccount = { owner: string; data: { parsed?: { info?: {
  mint?: string; owner?: string; state?: string; decimals?: number; isInitialized?: boolean;
  tokenAmount?: { amount?: string; decimals?: number };
} } } };

/** Product asset metadata is pinned; RPC must independently confirm that identity. */
export async function verifyRewardAsset(asset: RewardAsset) {
  await verifyMainnetRpc();
  const details = assetDetails(asset);
  if (details.kind === 'native') return;
  const result = await rpc<{ value: { owner: string; data: [string, string] } | null }>('getAccountInfo', [details.mint, { encoding: 'base64', commitment: 'finalized' }]);
  assertQuoteMint(result.value, details.decimals);
}

export async function getRewardBalance(wallet: string, asset: RewardAsset): Promise<bigint> {
  if (asset === 'SOL') return getNativeSolBalance(wallet);
  await verifyRewardAsset(asset);
  const details = assetDetails(asset);
  const ata = await rewardTokenAccount(wallet, asset);
  const result = await rpc<{ value: ParsedTokenAccount | null }>('getAccountInfo', [ata, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  if (!result.value) return 0n;
  const info = result.value.data.parsed?.info;
  if (result.value.owner !== details.tokenProgram || info?.owner !== wallet || info.mint !== details.mint)
    throw new Error('Reward token account ownership mismatch. Inspect the treasury account.');
  if (info.state !== 'initialized' || info.tokenAmount?.decimals !== details.decimals || !/^\d+$/.test(info.tokenAmount.amount ?? ''))
    throw new Error('Reward token account is unavailable or invalid. Inspect its state and balance.');
  return BigInt(info.tokenAmount!.amount!);
}

export async function verifyRewardTransfer(signature: string, source: string, destination: string, raw: string, asset: RewardAsset) {
  if (asset === 'SOL') return verifyNativeSolTransfer(signature, source, destination, raw);
  if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return null;
  await verifyRewardAsset(asset);
  const tx = await rpc<TokenPaymentReceipt | null>('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'finalized' }]);
  if (!tx || !await matchesTokenPayment(tx, source, destination, raw, asset)) return null;
  return { slot: tx.slot, blockTime: tx.blockTime };
}
