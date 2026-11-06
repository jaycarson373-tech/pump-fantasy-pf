import { getBase58Encoder } from "@solana/kit";
import {
  WALLET_POLICY,
  walletProgram,
  validateWalletInstructions,
} from "./wallet-policy";

import { record as object } from "../community-data";
import { tokenAmount } from "./types";
import { MEMO_PROGRAM } from "./types";
import type { BurnIntent, BurnProof } from "./types";

function reject(): never {
  throw new Error(
    "Transaction does not prove this quoted burn. Check its wallet, mint, amount and memo.",
  );
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) reject();
  return value;
}
function exactBurn(value: unknown, intent: BurnIntent) {
  const ix = object(value);
  if (ix.programId !== intent.tokenProgram) reject();
  const parsed = object(ix.parsed);
  const info = object(parsed.info);
  const amount = object(info.tokenAmount);
  if (
    parsed.type !== "burnChecked" ||
    info.mint !== intent.mint ||
    info.account !== intent.source
  )
    reject();
  if (
    info.authority !== intent.wallet ||
    amount.amount !== intent.amount ||
    amount.decimals !== intent.decimals
  )
    reject();
  if (info.multisigAuthority || info.signers) reject();
}
function instructions(value: unknown, intent: BurnIntent) {
  const all = list(value, WALLET_POLICY.MAX_INSTRUCTIONS).map(object);
  const extras = all.map((ix) => {
    if (!walletProgram(String(ix.programId)))
      return {
        program: String(ix.programId),
        accounts: [],
        data: new Uint8Array(),
      };
    if (
      typeof ix.data !== "string" ||
      ix.data.length > WALLET_POLICY.MAX_ASSERTION_BYTES * 2
    )
      reject();
    const accounts = list(ix.accounts, WALLET_POLICY.MAX_ASSERTION_ACCOUNTS);
    if (accounts.some((account) => typeof account !== "string")) reject();
    return {
      program: String(ix.programId),
      accounts: accounts as string[],
      data: Uint8Array.from(getBase58Encoder().encode(ix.data)),
    };
  });
  validateWalletInstructions(extras);
  const core = all.filter((ix) => !walletProgram(String(ix.programId)));
  if (core.length !== 2) reject();
  exactBurn(core[0], intent);
  const memo = core[1];
  if (memo.programId !== MEMO_PROGRAM || memo.parsed !== intent.memo) reject();
}
function sourceIndex(value: unknown, intent: BurnIntent): number {
  const keys = list(value, WALLET_POLICY.MAX_MESSAGE_ACCOUNTS).map(object);
  const signers = keys.filter((key) => key.signer === true);
  if (
    signers.length !== 1 ||
    signers[0].pubkey !== intent.wallet ||
    keys[0]?.pubkey !== intent.wallet
  )
    reject();
  const sources = keys.flatMap((key, index) =>
    key.pubkey === intent.source ? [index] : [],
  );
  if (sources.length !== 1 || keys[sources[0]].writable !== true) reject();
  return sources[0];
}
function balance(value: unknown, index: number, intent: BurnIntent) {
  const matches = list(value, WALLET_POLICY.MAX_TOKEN_BALANCES)
    .map(object)
    .filter((b) => b.accountIndex === index);
  if (matches.length !== 1) reject();
  const row = matches[0];
  if (
    row.owner !== intent.wallet ||
    row.mint !== intent.mint ||
    row.programId !== intent.tokenProgram
  )
    reject();
  const amount = object(row.uiTokenAmount);
  if (amount.decimals !== intent.decimals) reject();
  return BigInt(tokenAmount(amount.amount));
}
function otherBalances(value: unknown, source: number) {
  const result = new Map<number, string>();
  for (const row of list(value, WALLET_POLICY.MAX_TOKEN_BALANCES).map(object)) {
    const index = row.accountIndex;
    if (
      !Number.isSafeInteger(index) ||
      Number(index) < 0 ||
      result.has(Number(index))
    )
      reject();
    const amount = object(row.uiTokenAmount);
    const normalized = JSON.stringify([
      row.owner,
      row.mint,
      row.programId,
      amount.decimals,
      tokenAmount(amount.amount),
    ]);
    result.set(Number(index), normalized);
  }
  result.delete(source);
  return result;
}
function unrelatedEffects(before: unknown, after: unknown, source: number) {
  const original = otherBalances(before, source);
  const final = otherBalances(after, source);
  if (original.size !== final.size) reject();
  for (const [index, value] of original)
    if (final.get(index) !== value) reject();
}
function metadata(value: unknown, index: number, intent: BurnIntent) {
  const meta = object(value);
  if (meta.err !== null) reject();
  if (meta.innerInstructions !== null && list(meta.innerInstructions, 0).length)
    reject();
  const before = balance(meta.preTokenBalances, index, intent);
  const after = balance(meta.postTokenBalances, index, intent);
  if (before - after !== BigInt(intent.amount)) reject();
  unrelatedEffects(meta.preTokenBalances, meta.postTokenBalances, index);
}
export function verifyBurnProof(
  value: unknown,
  signature: string,
  intent: BurnIntent,
): BurnProof {
  const tx = object(value);
  if (!["legacy", 0, 1].includes(tx.version as string | number)) reject();
  if (!Number.isSafeInteger(tx.slot) || Number(tx.slot) < 0) reject();
  if (!Number.isSafeInteger(tx.blockTime) || Number(tx.blockTime) < 0) reject();
  if (Number(tx.blockTime) < intent.created - 5) reject();
  const transaction = object(tx.transaction);
  const signatures = list(transaction.signatures, 1);
  if (signatures.length !== 1 || signatures[0] !== signature) reject();
  const message = object(transaction.message);
  instructions(message.instructions, intent);
  const index = sourceIndex(message.accountKeys, intent);
  metadata(tx.meta, index, intent);
  return { signature, slot: Number(tx.slot), blockTime: Number(tx.blockTime) };
}
