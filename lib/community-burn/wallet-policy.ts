import { getCompiledTransactionMessageDecoder } from "@solana/kit";


// Adapted from enigma-launch/lib/wallet-edits.mjs at
// 2f296c4c40bae66018260e7dfe0ed0bd12692d99: semantic core comparison,
// fixed signers/lifetime and wallet-program allowlist. This legacy-only host
// tightens the donor's compute layouts, duplicates and total priority fee limit.
export const WALLET_POLICY = Object.freeze({
  COMPUTE_BUDGET: "ComputeBudget111111111111111111111111111111",
  LIGHTHOUSE: "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
  MAX_COMPUTE_UNITS: 1_400_000,
  DEFAULT_COMPUTE_UNITS: 200_000,
  MAX_PRIORITY_LAMPORTS: 100_000n,
  MAX_INSTRUCTIONS: 8,
  MAX_MESSAGE_ACCOUNTS: 16,
  MAX_TOKEN_BALANCES: 8,
  MAX_ASSERTION_BYTES: 1024,
  MAX_ASSERTION_ACCOUNTS: 16,
});
const MICRO_LAMPORTS = 1_000_000n;
const LIMIT_TAG = 2;
const PRICE_TAG = 3;
const LIMIT_BYTES = 5;
const PRICE_BYTES = 9;
const VALUE_OFFSET = 1;
export type WalletInstruction = {
  program: string;
  programPermission?: string;
  accounts: readonly string[];
  data: Uint8Array;
};
function reject(): never {
  throw new Error(
    "Wallet changed the reviewed burn or exceeded its priority fee limit. Reopen the original quote.",
  );
}
export function walletProgram(program: string) {
  return (
    program === WALLET_POLICY.COMPUTE_BUDGET ||
    program === WALLET_POLICY.LIGHTHOUSE
  );
}
export function computeLimitData(
  limit: number = WALLET_POLICY.DEFAULT_COMPUTE_UNITS,
) {
  const data = Buffer.alloc(LIMIT_BYTES);
  data[0] = LIMIT_TAG;
  data.writeUInt32LE(limit, VALUE_OFFSET);
  return data;
}
export function computePriceData(price = 0n) {
  const data = Buffer.alloc(PRICE_BYTES);
  data[0] = PRICE_TAG;
  data.writeBigUInt64LE(price, VALUE_OFFSET);
  return data;
}
function computeSetting(ix: WalletInstruction): { tag: number; value: bigint } {
  if (ix.accounts.length) reject();
  const data = Buffer.from(ix.data);
  if (data[0] === LIMIT_TAG && data.length === LIMIT_BYTES) {
    const value = data.readUInt32LE(VALUE_OFFSET);
    if (!value || value > WALLET_POLICY.MAX_COMPUTE_UNITS) reject();
    return { tag: LIMIT_TAG, value: BigInt(value) };
  }
  if (data[0] === PRICE_TAG && data.length === PRICE_BYTES)
    return { tag: PRICE_TAG, value: data.readBigUInt64LE(VALUE_OFFSET) };
  return reject();
}
function validateAssertion(ix: WalletInstruction) {
  if (
    !ix.data.length ||
    ix.data.length > WALLET_POLICY.MAX_ASSERTION_BYTES ||
    ix.accounts.length > WALLET_POLICY.MAX_ASSERTION_ACCOUNTS
  )
    reject();
}
export function validateWalletInstructions(
  instructions: readonly WalletInstruction[],
) {
  if (instructions.length > WALLET_POLICY.MAX_INSTRUCTIONS) reject();
  const settings = new Map<number, bigint>();
  for (const ix of instructions) {
    if (ix.program === WALLET_POLICY.LIGHTHOUSE) validateAssertion(ix);
    if (ix.program !== WALLET_POLICY.COMPUTE_BUDGET) continue;
    const setting = computeSetting(ix);
    if (settings.has(setting.tag)) reject();
    settings.set(setting.tag, setting.value);
  }
  const units =
    settings.get(LIMIT_TAG) ?? BigInt(WALLET_POLICY.MAX_COMPUTE_UNITS);
  const price = settings.get(PRICE_TAG) ?? 0n;
  const fee = (units * price + MICRO_LAMPORTS - 1n) / MICRO_LAMPORTS;
  if (fee > WALLET_POLICY.MAX_PRIORITY_LAMPORTS) reject();
  return instructions.filter((ix) => !walletProgram(ix.program));
}
function readMessage(bytes: Uint8Array) {
  const message = getCompiledTransactionMessageDecoder().decode(bytes);
  if (message.version !== "legacy") reject();
  const {
    numSignerAccounts,
    numReadonlySignerAccounts,
    numReadonlyNonSignerAccounts,
  } = message.header;
  const keys = message.staticAccounts;
  if (keys.length > WALLET_POLICY.MAX_MESSAGE_ACCOUNTS) reject();
  const accounts = keys.map((key, index) => {
    const writable =
      index < numSignerAccounts
        ? index < numSignerAccounts - numReadonlySignerAccounts
        : index < keys.length - numReadonlyNonSignerAccounts;
    return `${key}:${writable}`;
  });
  return {
    signers: keys.slice(0, numSignerAccounts),
    lifetime: message.lifetimeToken,
    instructions: message.instructions.map((ix) => ({
      program: String(keys[ix.programAddressIndex]),
      programPermission: accounts[ix.programAddressIndex],
      accounts: (ix.accountIndices ?? []).map((index) => accounts[index]),
      data: Uint8Array.from(ix.data ?? []),
    })),
  };
}
const same = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
export function assertWalletEditsAllowed(
  reviewedBytes: Uint8Array,
  signedBytes: Uint8Array,
) {
  const reviewed = readMessage(reviewedBytes);
  const signed = readMessage(signedBytes);
  if (
    !same(reviewed.signers, signed.signers) ||
    reviewed.lifetime !== signed.lifetime
  )
    reject();
  const before = validateWalletInstructions(reviewed.instructions);
  const after = validateWalletInstructions(signed.instructions);
  if (before.length !== after.length) reject();
  for (const [index, ix] of before.entries()) {
    const actual = after[index];
    if (
      ix.program !== actual.program ||
      ix.programPermission !== actual.programPermission ||
      !same(ix.accounts, actual.accounts) ||
      !same(Array.from(ix.data), Array.from(actual.data))
    )
      reject();
  }
}
