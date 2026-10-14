export const DAILY_FEE_BPS = 6500n;
export const REWARD_RESERVE_BPS = 3500n;

export function splitCreatorFees(gross: bigint) {
  if (gross < 0n) throw new Error("Creator fees cannot be negative.");
  const daily = gross * DAILY_FEE_BPS / 10000n;
  return { gross, daily, reserve: gross - daily };
}

type TokenBalance = { accountIndex: number; mint: string; uiTokenAmount: { amount: string } };
/** Read only the two known creator vaults, never unrelated wallet deposits. */
export function collectedFeesFromBalances(
  keys: string[],
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBalance[] | null; postTokenBalances?: TokenBalance[] | null },
  solVault: string,
  ammVaultAta: string,
  wrappedSolMint: string,
) {
  if (meta.err) throw new Error("Fee collection failed onchain.");
  const index = keys.indexOf(solVault);
  let gross = 0n;
  if (index >= 0) {
    const before = meta.preBalances[index];
    const after = meta.postBalances[index];
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || after > before) throw new Error("Invalid creator vault balance change.");
    gross += BigInt(before) - BigInt(after);
  }
  const ataIndex = keys.indexOf(ammVaultAta);
  if (ataIndex >= 0) {
    const before = meta.preTokenBalances?.find((b) => b.accountIndex === ataIndex && b.mint === wrappedSolMint)?.uiTokenAmount.amount ?? "0";
    const after = meta.postTokenBalances?.find((b) => b.accountIndex === ataIndex && b.mint === wrappedSolMint)?.uiTokenAmount.amount ?? "0";
    const delta = BigInt(before) - BigInt(after);
    if (delta < 0n) throw new Error("Invalid AMM creator vault change.");
    gross += delta;
  }
  return gross;
}
