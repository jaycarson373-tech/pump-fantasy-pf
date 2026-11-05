import "server-only";
import { readPayoutSigner, signPayoutTransaction } from "./payout-signing";

export async function payoutSigner() {
  const text = process.env.PF_PAYOUT_SIGNER_KEYPAIR_JSON;
  if (!text) return null;
  return readPayoutSigner(text, process.env.PF_PRIZE_WALLET_ADDRESS || "");
}

export async function signPayout(unsignedBase64: string, wallet: string) {
  const signer = await payoutSigner();
  if (!signer || signer.address !== wallet)
    throw new Error("Payout signer is unavailable or mismatched. Configure the prize wallet keypair.");
  return signPayoutTransaction(unsignedBase64, signer);
}
