import { address, getAddressEncoder, getProgramDerivedAddress, type Instruction } from '@solana/kit';
import { assetDetails, type RewardAsset } from '../reward-asset';

const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const TRANSFER_CHECKED = 12;
const U64_MAX = (1n << 64n) - 1n;
const encoder = getAddressEncoder();

export async function rewardTokenAccount(owner: string, asset: RewardAsset) {
  const details = assetDetails(asset);
  return (await getProgramDerivedAddress({ programAddress: ATA_PROGRAM, seeds: [
    encoder.encode(address(owner)), encoder.encode(address(details.tokenProgram)), encoder.encode(address(details.mint)),
  ] }))[0];
}

export async function tokenPaymentInstructions(source: string, destination: string, raw: string, asset: RewardAsset): Promise<Instruction[]> {
  const details = assetDetails(asset);
  if (details.kind !== 'token' || !/^[1-9]\d*$/.test(raw) || BigInt(raw) > U64_MAX)
    throw new Error('Invalid token payment. Use a supported token and positive u64 base units.');
  const from = await rewardTokenAccount(source, asset);
  const to = await rewardTokenAccount(destination, asset);
  const data = Buffer.alloc(10);
  data[0] = TRANSFER_CHECKED;
  data.writeBigUInt64LE(BigInt(raw), 1);
  data[9] = details.decimals;
  return [
    { programAddress: ATA_PROGRAM, data: Uint8Array.of(1), accounts: [
      { address: address(source), role: 3 }, { address: to, role: 1 },
      { address: address(destination), role: 0 }, { address: address(details.mint), role: 0 },
      { address: SYSTEM_PROGRAM, role: 0 }, { address: address(details.tokenProgram), role: 0 },
    ] },
    { programAddress: address(details.tokenProgram), data, accounts: [
      { address: from, role: 1 }, { address: address(details.mint), role: 0 },
      { address: to, role: 1 }, { address: address(source), role: 2 },
    ] },
  ];
}

type Balance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
type ParsedInstruction = { programId?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; authority?: string; mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } };
export type TokenPaymentReceipt = {
  slot: number; blockTime: number | null;
  meta: { err: unknown; preTokenBalances?: Balance[]; postTokenBalances?: Balance[] } | null;
  transaction: { message: { accountKeys: Array<{ pubkey: string; signer?: boolean }>; instructions: ParsedInstruction[] } };
};

function balanceAt(balances: Balance[], index: number, owner: string, asset: RewardAsset) {
  const item = balances.find(balance => balance.accountIndex === index);
  if (!item) return 0n;
  const details = assetDetails(asset);
  if (item.mint !== details.mint || item.owner !== owner || item.uiTokenAmount.decimals !== details.decimals || !/^\d+$/.test(item.uiTokenAmount.amount))
    throw new Error('Token receipt account identity mismatch. Inspect the finalized transaction.');
  return BigInt(item.uiTokenAmount.amount);
}

function exactTransfer(instruction: ParsedInstruction, source: string, from: string, to: string, raw: string, asset: RewardAsset) {
  const details = assetDetails(asset);
  const info = instruction.parsed?.info;
  if (instruction.programId !== details.tokenProgram || instruction.parsed?.type !== 'transferChecked' || !info) return false;
  return info.source === from && info.destination === to && info.authority === source &&
    info.mint === details.mint && info.tokenAmount?.amount === raw && info.tokenAmount.decimals === details.decimals;
}

/** A matching instruction alone is insufficient: verify signer and actual recipient credit. */
export async function matchesTokenPayment(tx: TokenPaymentReceipt, source: string, winner: string, raw: string, asset: RewardAsset) {
  if (!tx.meta || tx.meta.err !== null || !/^[1-9]\d*$/.test(raw)) return false;
  const keys = tx.transaction.message.accountKeys;
  if (!keys.some(key => key.pubkey === source && key.signer)) return false;
  const from = await rewardTokenAccount(source, asset), to = await rewardTokenAccount(winner, asset);
  const matching = tx.transaction.message.instructions.filter(ix => exactTransfer(ix, source, from, to, raw, asset));
  if (matching.length !== 1) return false;
  const fromIndex = keys.findIndex(key => key.pubkey === from), toIndex = keys.findIndex(key => key.pubkey === to);
  if (fromIndex < 0 || toIndex < 0) return false;
  try {
    const before = tx.meta.preTokenBalances ?? [], after = tx.meta.postTokenBalances ?? [];
    const debit = balanceAt(before, fromIndex, source, asset) - balanceAt(after, fromIndex, source, asset);
    const credit = balanceAt(after, toIndex, winner, asset) - balanceAt(before, toIndex, winner, asset);
    return debit === BigInt(raw) && credit === BigInt(raw);
  } catch { return false; }
}
