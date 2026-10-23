import "server-only";
import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { getBackendConfig } from "./config";
import { queryRows } from "./database";
import { validWallet } from "./http";
import { getFeeTreasury } from "./fee-treasury";
import { getNativeSolBalance, verifyMainnetRpc } from "./solana";
import { explicitPayoutCap, finalizedPayoutDisposition, RESERVED_AWARD_STATUSES, seasonAwardFits } from "./payout-policy";
import { managedPayoutAddress, signManagedPayout } from "./managed-signer";
import { assertFinalizedWire } from "./creator-protocol.mjs";

type Award = {
  id: string;
  season_id: string;
  winner_wallet: string | null;
  prize_lamports: string;
  status: string;
  payment_signature: string | null;
  payment_tx_base64: string | null;
  payment_blockhash: string | null;
  payment_last_valid_block_height: string | null;
  payment_network: string | null;
};

type RpcResult<T> = { result?: T; error?: { message?: string } };

export type PayoutConfiguration = { enabled: boolean; blockers: string[]; signerAddress: string | null; perAwardCap: bigint | null; seasonCap: bigint | null; rpcUrl: string | null };

async function readSigner() {
  const wallet=managedPayoutAddress();
  return wallet ? createNoopSigner(wallet) : null;
}

export async function getPayoutConfiguration(): Promise<PayoutConfiguration> {
  const config = getBackendConfig();
  const enabled = process.env.PF_AUTO_PAYOUT_ENABLED === "true";
  const blockers: string[] = [];
  const signer = await readSigner();
  const prizeWallet = process.env.PF_PRIZE_WALLET_ADDRESS || "";
  const perAwardCap = explicitPayoutCap(process.env.PF_AUTO_PAYOUT_MAX_AWARD_LAMPORTS);
  const seasonCap = explicitPayoutCap(process.env.PF_AUTO_PAYOUT_MAX_SEASON_LAMPORTS);
  if (!enabled) blockers.push("Set PF_AUTO_PAYOUT_ENABLED=true only after reviewing the signer and payout limits.");
  if (!signer) blockers.push("Connect the policy-limited Turnkey signing account for the prize wallet; configure API authentication only as server secrets.");
  if (!validWallet(prizeWallet)) blockers.push("Set PF_PRIZE_WALLET_ADDRESS to the payout wallet public address.");
  if (signer && validWallet(prizeWallet) && signer.address !== prizeWallet) blockers.push("Payout signer does not match PF_PRIZE_WALLET_ADDRESS.");
  if (!perAwardCap) blockers.push("Set PF_AUTO_PAYOUT_MAX_AWARD_LAMPORTS to a positive per-award cap.");
  if (!seasonCap) blockers.push("Set PF_AUTO_PAYOUT_MAX_SEASON_LAMPORTS to a positive per-season cap.");
  const network = process.env.PF_PAYOUT_NETWORK || "";
  if (network !== "mainnet-beta") blockers.push("Set PF_PAYOUT_NETWORK=mainnet-beta to explicitly allow mainnet awards.");
  try { await verifyMainnetRpc(); }
  catch { blockers.push("SOLANA_RPC_URL must return the Solana mainnet genesis hash before automatic payouts can run."); }
  return { enabled, blockers, signerAddress: signer?.address ?? null, perAwardCap, seasonCap, rpcUrl: config.rpcUrl ?? null };
}

async function rpc<T>(method: string, params: unknown[]) {
  const config = getBackendConfig();
  if (!config.rpcUrl) throw new Error("Solana RPC is not configured.");
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: "pump-fantasy-payout", method, params }),
  });
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}.`);
  const body = await response.json() as RpcResult<T>;
  if (body.error || body.result === undefined) throw new Error(body.error?.message || "Solana RPC returned no result.");
  return body.result;
}

async function markPaid(award: Award) {
  if (!award.payment_signature) return;
  await queryRows("update pf_daily_awards set status = 'paid', paid_at = coalesce(paid_at, now()), payment_updated_at = now() where id = $1 and status in ('payment_prepared','payment_unknown')", [award.id]);
}

async function processPrepared(award: Award) {
  if (!award.payment_signature || !award.payment_tx_base64 || !award.payment_last_valid_block_height || award.payment_network !== "mainnet-beta") {
    await queryRows("update pf_daily_awards set status = 'payment_unknown', payment_updated_at = now() where id = $1 and status = 'payment_prepared'", [award.id]);
    return "payment-unknown";
  }
  const statuses = await rpc<{ value: Array<{ err: unknown; confirmationStatus: string | null } | null> }>("getSignatureStatuses", [[award.payment_signature], { searchTransactionHistory: true }]);
  const status = statuses.value[0];
  const disposition = finalizedPayoutDisposition(status);
  if (disposition === "failed") {
    await queryRows("update pf_daily_awards set status = 'payment_failed', payment_updated_at = now() where id = $1 and status in ('payment_prepared','payment_unknown')", [award.id]);
    return "payment-failed";
  }
  if (disposition === "paid") {
    const receipt = await rpc("getTransaction", [award.payment_signature, {encoding:"base64",commitment:"finalized",maxSupportedTransactionVersion:0}]);
    if (!receipt) return "payment-awaiting-receipt";
    assertFinalizedWire(award.payment_tx_base64, receipt);
    await markPaid(award);
    return "paid";
  }
  if (status) return "payment-pending-finality";
  const currentHeight = await rpc<string>("getBlockHeight", [{ commitment: "confirmed" }]);
  if (BigInt(currentHeight) > BigInt(award.payment_last_valid_block_height)) {
    await queryRows("update pf_daily_awards set status = 'payment_unknown', payment_updated_at = now() where id = $1 and status = 'payment_prepared'", [award.id]);
    return "payment-unknown";
  }
  const submittedSignature = await rpc<string>("sendTransaction", [award.payment_tx_base64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
  if (submittedSignature !== award.payment_signature) throw new Error("RPC returned a different signature for the persisted payout transaction.");
  await queryRows("update pf_daily_awards set payment_attempts = payment_attempts + 1, payment_updated_at = now() where id = $1 and status in ('payment_prepared','payment_unknown')", [award.id]);
  return "payment-submitted";
}

async function prepareAward(award: Award, config: PayoutConfiguration) {
  if (award.status !== "pending_payment") return null;
  if (!config.enabled || config.blockers.length || !config.perAwardCap || !config.seasonCap) return "payout-disabled";
  if (!award.winner_wallet || !validWallet(award.winner_wallet)) throw new Error("Award recipient is invalid.");
  const amount = BigInt(award.prize_lamports);
  if (amount <= 0n || amount > config.perAwardCap) {
    await queryRows("update pf_daily_awards set status = 'payment_failed', payment_updated_at = now() where id = $1 and status = 'pending_payment'", [award.id]);
    return "payout-cap-exceeded";
  }
  if (award.winner_wallet === process.env.PF_PRIZE_WALLET_ADDRESS) {
    await queryRows("update pf_daily_awards set status = 'payment_failed', payment_updated_at = now() where id = $1 and status = 'pending_payment'", [award.id]);
    return "invalid-payout-recipient";
  }
  const seasonReserved = await queryRows<{ total: string }>("select coalesce(sum(prize_lamports), 0)::text as total from pf_daily_awards where season_id = $1 and status = any($2::text[]) and (status <> 'payment_failed' or payment_signature is not null)", [award.season_id, [...RESERVED_AWARD_STATUSES]]);
  if (!seasonAwardFits(config.seasonCap, BigInt(seasonReserved[0]?.total || "0"), amount)) {
    await queryRows("update pf_daily_awards set status = 'payment_failed', payment_updated_at = now() where id = $1 and status = 'pending_payment'", [award.id]);
    return "season-cap-exceeded";
  }
  const signer = await readSigner();
  const prizeWallet = process.env.PF_PRIZE_WALLET_ADDRESS || "";
  if (!signer || signer.address !== prizeWallet) throw new Error("Payout signer configuration is invalid.");
  const rewardSeason = (await queryRows<{ mint_address: string | null; prize_mode: string }>("select mint_address, prize_mode from pf_seasons where id=$1", [award.season_id]))[0];
  let treasuryMinimum = amount + 5_000n;
  if (rewardSeason?.prize_mode === "creator-fees") {
    if (!rewardSeason.mint_address) return "missing-reward-mint";
    const allocation = await queryRows<{ amount: string }>("select coalesce(sum(daily_lamports),0)::text as amount from pf_creator_fee_receipts where award_id=$1 and mint_address=$2", [award.id, rewardSeason.mint_address]);
    if (BigInt(allocation[0]?.amount ?? 0) !== amount) throw new Error("Daily award does not match its confirmed 65% fee allocation.");
    const treasury = await getFeeTreasury(rewardSeason.mint_address);
    // Keep all other daily allocations and the entire 35% reserve intact.
    treasuryMinimum = treasury.daily - treasury.paid + treasury.reserve + 5_000n;
  }
  const balance = await getNativeSolBalance(prizeWallet);
  if (balance < treasuryMinimum) return "awaiting-payout-funding";
  const lifetime = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const instruction = getTransferSolInstruction({ source: signer, destination: address(award.winner_wallet), amount });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(lifetime.value.blockhash), lastValidBlockHeight: BigInt(lifetime.value.lastValidBlockHeight) }, tx),
    (tx) => appendTransactionMessageInstruction(instruction, tx),
  );
  const unsigned = getBase64EncodedWireTransaction(compileTransaction(message));
  const simulation = await rpc<{ value: { err: unknown } }>("simulateTransaction", [unsigned, { encoding: "base64", sigVerify: false, commitment: "confirmed" }]);
  if (simulation.value.err) throw new Error("Automatic payout simulation failed; no transaction was submitted.");
  const wire=await signManagedPayout(unsigned,signer.address);
  const signature=getSignatureFromTransaction(getTransactionDecoder().decode(Buffer.from(wire,"base64")));
  const prepared = await queryRows<{ id: string }>(
    "update pf_daily_awards set status = 'payment_prepared', payment_signature = $2, payment_tx_base64 = $3, payment_blockhash = $4, payment_last_valid_block_height = $5, payment_network = 'mainnet-beta', payment_updated_at = now() where id = $1 and status = 'pending_payment' and payment_signature is null returning id",
    [award.id, signature, wire, lifetime.value.blockhash, String(lifetime.value.lastValidBlockHeight)],
  );
  if (!prepared.length) return "payout-state-changed";
  return processPrepared({ ...award, status: "payment_prepared", payment_signature: signature, payment_tx_base64: wire, payment_blockhash: lifetime.value.blockhash, payment_last_valid_block_height: String(lifetime.value.lastValidBlockHeight), payment_network: "mainnet-beta" });
}

/** Processes no more than one deterministic SOL award transfer per invocation. */
export async function processNextAutomaticPayout() {
  const config = await getPayoutConfiguration();
  if (!config.enabled) return { action: "payout-disabled" as const, blockers: config.blockers };
  const prepared = await queryRows<Award>("select id, season_id, winner_wallet, prize_lamports, status, payment_signature, payment_tx_base64, payment_blockhash, payment_last_valid_block_height, payment_network from pf_daily_awards where status in ('payment_prepared','payment_unknown') order by created_at asc limit 1");
  if (prepared[0]) return { action: await processPrepared(prepared[0]), awardId: prepared[0].id };
  const pending = await queryRows<Award>("select id, season_id, winner_wallet, prize_lamports, status, payment_signature, payment_tx_base64, payment_blockhash, payment_last_valid_block_height, payment_network from pf_daily_awards where status = 'pending_payment' order by created_at asc limit 1");
  if (!pending[0]) return { action: "no-pending-award" as const };
  return { action: await prepareAward(pending[0], config), awardId: pending[0].id };
}
