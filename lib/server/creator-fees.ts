import "server-only";
// The official Pump SDK builds legacy web3 instructions. This adapter is
// isolated from the application's Kit-based wallets and winner transfers.
import { OnlinePumpSdk, creatorVaultPda, normalizeQuoteMint } from "@pump-fun/pump-sdk";
import { coinCreatorVaultAtaPda, coinCreatorVaultAuthorityPda } from "@pump-fun/pump-swap-sdk";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { queryRows, withTransaction } from "./database";
import { getFeeTreasury } from "./fee-treasury";
import { getBackendConfig } from "./config";
import { readPayoutSignerBytes } from "./automatic-payout";
import { collectedFeesFromBalances, splitCreatorFees } from "./fee-accounting";

type Claim = { signature: string; mint_address: string; creator_wallet: string; transaction_base64: string; last_valid_block_height: string; status: string };

export async function creatorFeeConfigurationBlockers() {
  const { mint, rpcUrl } = getBackendConfig();
  const creator = process.env.PF_CREATOR_WALLET_ADDRESS;
  const blockers: string[] = [];
  if (process.env.PF_FEE_COLLECTION_ENABLED !== "true") blockers.push("Enable PF_FEE_COLLECTION_ENABLED for creator-fee collection.");
  if (process.env.PF_CREATOR_WALLET_DEDICATED !== "true") blockers.push("Confirm PF_CREATOR_WALLET_DEDICATED=true for the new token's dedicated creator wallet.");
  if (!creator || creator !== process.env.PF_PRIZE_WALLET_ADDRESS) blockers.push("PF_CREATOR_WALLET_ADDRESS must match the dedicated prize wallet.");
  if (!mint || !rpcUrl || !creator) return [...blockers, "New token mint and creator wallet are required."];
  try {
    const sdk = new OnlinePumpSdk(new Connection(rpcUrl, "confirmed"));
    const curve = await sdk.fetchBondingCurve(new PublicKey(mint));
    if (curve.creator.toBase58() !== creator) blockers.push("The new token's onchain creator does not match the configured wallet (shared-fee configurations are not supported by this collector).");
    if (!normalizeQuoteMint(curve.quoteMint).equals(NATIVE_MINT)) blockers.push("Automatic reward collection currently requires a SOL-quoted token.");
  } catch { blockers.push("Could not verify the new token's Pump creator configuration."); }
  return blockers;
}

async function resumeClaim(connection: Connection, claim: Claim) {
  const state = (await connection.getSignatureStatuses([claim.signature], { searchTransactionHistory: true })).value[0];
  if (state?.err) {
    await queryRows("update pf_creator_claims set status='failed' where signature=$1", [claim.signature]);
    return "claim-failed";
  }
  if (state?.confirmationStatus === "finalized") {
    const tx = await connection.getTransaction(claim.signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return "claim-awaiting-receipt";
    const creator = new PublicKey(claim.creator_wallet);
    const keys = tx.transaction.message.staticAccountKeys.map((key) => key.toBase58());
    const gross = collectedFeesFromBalances(keys, tx.meta, creatorVaultPda(creator).toBase58(), coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(creator), NATIVE_MINT, TOKEN_PROGRAM_ID).toBase58(), NATIVE_MINT.toBase58());
    const allocation = splitCreatorFees(gross);
    await withTransaction(async (query) => {
      if (gross > 0n) await query("insert into pf_creator_fee_receipts(signature,mint_address,gross_lamports,daily_lamports,reserve_lamports) values($1,$2,$3,$4,$5) on conflict(signature) do nothing", [claim.signature,claim.mint_address,gross.toString(),allocation.daily.toString(),allocation.reserve.toString()]);
      await query("update pf_creator_claims set status='finalized' where signature=$1", [claim.signature]);
    });
    return "claim-finalized";
  }
  if (state) return "claim-confirming";
  if (BigInt(await connection.getBlockHeight("confirmed")) > BigInt(claim.last_valid_block_height)) {
    await queryRows("update pf_creator_claims set status='unknown' where signature=$1", [claim.signature]);
    return "claim-needs-reconciliation";
  }
  const signature = await connection.sendRawTransaction(Buffer.from(claim.transaction_base64,"base64"), { skipPreflight: false, maxRetries: 0 });
  if (signature !== claim.signature) throw new Error("Fee claim signature mismatch.");
  return "claim-submitted";
}

/** Called under the season worker lock. Persist before broadcast; never re-sign
 * an uncertain transaction, and book only finalized vault withdrawals. */
export async function collectCreatorFees() {
  const { rpcUrl, mint } = getBackendConfig();
  if (process.env.PF_FEE_COLLECTION_ENABLED !== "true" || !rpcUrl || !mint) return "collection-disabled";
  const connection = new Connection(rpcUrl, "confirmed");
  const outstanding = await queryRows<Claim>("select * from pf_creator_claims where status in ('prepared','unknown') order by created_at limit 1");
  if (outstanding[0]) return outstanding[0].status === "unknown" ? "claim-needs-reconciliation" : resumeClaim(connection, outstanding[0]);
  const blockers = await creatorFeeConfigurationBlockers();
  if (blockers.length) return "collection-not-configured";
  const bytes = readPayoutSignerBytes();
  if (!bytes) return "collection-no-signer";
  let signer: Keypair;
  try { signer = Keypair.fromSecretKey(bytes); } finally { bytes.fill(0); }
  try {
    if (signer.publicKey.toBase58() !== process.env.PF_CREATOR_WALLET_ADDRESS) return "collection-signer-mismatch";
    const sdk = new OnlinePumpSdk(connection);
    // Skip dust: the operator funds gas separately; it is never deducted
    // from the recorded gross fee split or the long-term reward reserve.
    if (BigInt((await sdk.getCreatorVaultBalanceBothPrograms(signer.publicKey)).toString()) < 50_000n) return "no-claimable-fees";
    const treasury = await getFeeTreasury(mint);
    const protectedBalance = treasury.daily - treasury.paid + treasury.reserve + 2_500_000n;
    if (BigInt(await connection.getBalance(signer.publicKey)) < protectedBalance) return "collection-needs-gas";
    const instructions = await sdk.collectCoinCreatorFeeV2Instructions(signer.publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);
    const lifetime = await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: lifetime.blockhash, instructions }).compileToV0Message());
    transaction.sign([signer]);
    const simulation = await connection.simulateTransaction(transaction, { sigVerify: true, commitment: "confirmed" });
    if (simulation.value.err) throw new Error("Creator-fee claim simulation failed. Nothing was sent.");
    const wire = Buffer.from(transaction.serialize()).toString("base64");
    // Reuse Kit's base58 signature encoding via the web3 transaction signature.
    const { getBase58Decoder } = await import("@solana/kit");
    const signature = getBase58Decoder().decode(transaction.signatures[0]);
    const claim: Claim = { signature, mint_address: mint, creator_wallet: signer.publicKey.toBase58(), transaction_base64: wire, last_valid_block_height: String(lifetime.lastValidBlockHeight), status: "prepared" };
    await queryRows("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status) values($1,$2,$3,$4,$5,'prepared')", [signature,mint,claim.creator_wallet,wire,claim.last_valid_block_height]);
    return resumeClaim(connection, claim);
  } finally { signer.secretKey.fill(0); }
}
