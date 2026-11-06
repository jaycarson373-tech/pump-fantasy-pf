export type RewardAsset = 'SOL' | 'PUMP';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSETS = {
  SOL: { kind: 'native', mint: 'So11111111111111111111111111111111111111112', tokenProgram: TOKEN_PROGRAM, decimals: 9, symbol: 'SOL' },
  PUMP: { kind: 'token', mint: 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn', tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', decimals: 6, symbol: '$PUMP' },
} as const;

export function rewardAsset(value: unknown): RewardAsset {
  if (value === 'SOL' || value === 'PUMP') return value;
  throw new Error('Unknown reward asset. Configure SOL or PUMP explicitly.');
}

export function assetDetails(asset: RewardAsset) {
  return ASSETS[rewardAsset(asset)];
}

/** Preserve all raw units, including amounts above JavaScript's exact number range. */
export function formatRewardAmount(raw: string, asset: RewardAsset): string {
  if (!/^\d+$/.test(raw)) throw new Error('Invalid reward amount. Supply nonnegative integer base units.');
  const { decimals } = assetDetails(asset);
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(raw);
  const whole = (value / scale).toLocaleString('en-US');
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
