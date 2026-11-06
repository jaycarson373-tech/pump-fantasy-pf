export const DAILY_FEE_BPS = 3000n;
export const SEASON_FEE_BPS = 5000n;
export const REWARD_RESERVE_BPS = 2000n;

export function splitCreatorFees(gross: bigint) {
  if (gross < 0n) throw new Error("Creator fees cannot be negative.");
  const daily = gross * DAILY_FEE_BPS / 10000n;
  const season = gross * SEASON_FEE_BPS / 10000n;
  return { gross, daily, season, reserve: gross - daily - season };
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

type QuoteBalance = TokenBalance & { owner?: string; programId?: string; uiTokenAmount: { amount: string; decimals?: number } };
type QuoteIdentity = { address: string; owner: string };
type QuoteAsset = { mint: string; tokenProgram: string; decimals: number };
function quoteBalanceAt(balances: QuoteBalance[] | null | undefined, index: number, owner: string, asset: QuoteAsset) {
  const entries = balances?.filter(balance => balance.accountIndex === index) ?? [];
  if (!entries.length) return 0n;
  const [balance] = entries;
  if (entries.length !== 1 || balance.mint !== asset.mint || balance.owner !== owner ||
    balance.programId !== asset.tokenProgram || balance.uiTokenAmount.decimals !== asset.decimals || !/^\d+$/.test(balance.uiTokenAmount.amount)) {
    throw new Error("Finalized reward token identity or balance is invalid; reconcile the receipt before crediting it.");
  }
  return BigInt(balance.uiTokenAmount.amount);
}
/** Match actual destination credit to the known route's net token withdrawals.
 * Intermediate vaults may receive and empty in this same transaction. SOL gas and
 * account rent do not enter token rewards. Exact persisted wire is checked first. */
export function collectedTokenFeesFromBalances(
  keys: string[],
  meta: { err: unknown; preTokenBalances?: QuoteBalance[] | null; postTokenBalances?: QuoteBalance[] | null },
  destination: QuoteIdentity,
  sources: QuoteIdentity[],
  asset: QuoteAsset,
) {
  if (meta.err) throw new Error("Fee collection failed onchain; do not credit rewards.");
  const destinationIndex = keys.indexOf(destination.address);
  if (destinationIndex < 0 || !meta.postTokenBalances?.some(balance => balance.accountIndex === destinationIndex)) throw new Error("Finalized reward destination is missing; reconcile the persisted claim.");
  const delta = (identity: QuoteIdentity) => {
    const index = keys.indexOf(identity.address);
    if (index < 0) return 0n;
    return quoteBalanceAt(meta.postTokenBalances, index, identity.owner, asset) - quoteBalanceAt(meta.preTokenBalances, index, identity.owner, asset);
  };
  const received = delta(destination);
  const withdrawn = -sources.reduce((sum, source) => sum + delta(source), 0n);
  if (received < 0n || received !== withdrawn) throw new Error("Finalized reward credit differs from its known source withdrawals; reconcile before crediting.");
  return received;
}
