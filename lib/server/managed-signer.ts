import "server-only";
import { address } from "@solana/kit";
import { assertManagedPayoutProof } from "./managed-proof";

export function managedPayoutAddress() {
  if (!process.env.TURNKEY_ORGANIZATION_ID || !process.env.TURNKEY_API_PUBLIC_KEY || !process.env.TURNKEY_API_PRIVATE_KEY) return null;
  try { return address(process.env.PF_PRIZE_WALLET_ADDRESS || ""); } catch { return null; }
}
/** Signing only: the caller must persist these exact signed bytes before sending. */
export async function signManagedPayout(unsignedBase64: string, wallet: string) {
  if (managedPayoutAddress() !== wallet) throw new Error("Connect the policy-limited payout signing account first.");
  const { Turnkey } = await import("@turnkey/sdk-server");
  const client = new Turnkey({ apiBaseUrl: "https://api.turnkey.com",
    apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!, apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID! }).apiClient();
  let response;
  try {
    response = await client.signTransaction({ organizationId: process.env.TURNKEY_ORGANIZATION_ID!,
      signWith: wallet, unsignedTransaction: Buffer.from(unsignedBase64, "base64").toString("hex"), type: "TRANSACTION_TYPE_SOLANA" });
  } catch { throw new Error("Managed signing did not complete. No transaction was broadcast by the signer."); }
  if (response.activity.status !== "ACTIVITY_STATUS_COMPLETED" || !/^(?:[a-f0-9]{2})+$/i.test(response.signedTransaction || ""))
    throw new Error("The managed payout policy has not approved this transaction.");
  const signedBase64 = Buffer.from(response.signedTransaction, "hex").toString("base64");
  assertManagedPayoutProof(unsignedBase64,signedBase64,wallet);
  return signedBase64;
}
