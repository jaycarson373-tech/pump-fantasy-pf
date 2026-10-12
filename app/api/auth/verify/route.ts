import { createPublicKey, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { decodeBase58 } from "../../../../lib/server/base58";
import { getBackendConfig, supabaseRequest } from "../../../../lib/server/config";
import { routeError, sameOrigin, validWallet } from "../../../../lib/server/http";
import { setWalletSession } from "../../../../lib/server/session";
import { getHolderBalance } from "../../../../lib/server/solana";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const body = await request.json();
    const wallet = body.wallet;
    const message = body.message;
    const signatureText = body.signature;
    if (!validWallet(wallet) || typeof message !== "string" || typeof signatureText !== "string") return NextResponse.json({ error: "Invalid wallet signature request." }, { status: 400 });
    const config = getBackendConfig();
    if (!config.ready) return NextResponse.json({ error: "Wallet sign-in and holder checks are not configured yet.", code: "NOT_CONFIGURED" }, { status: 503 });
    const records = await supabaseRequest<Array<{ nonce: string; expires_at: string }>>(`pf_nonces?wallet=eq.${encodeURIComponent(wallet)}&select=nonce,expires_at&limit=1`);
    const nonceRecord = records[0];
    if (!nonceRecord || new Date(nonceRecord.expires_at).getTime() < Date.now() || !message.includes(`Nonce: ${nonceRecord.nonce}`)) {
      return NextResponse.json({ error: "Sign-in challenge expired. Please try again." }, { status: 401 });
    }
    const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const messagePrefix = `${new URL(site).host} wants you to sign in with your Solana account:\n${wallet}\n\n`;
    if (!message.startsWith(messagePrefix)) return NextResponse.json({ error: "Sign-in message does not match this site and wallet." }, { status: 401 });
    const suppliedSignature = Buffer.from(signatureText, "base64");
    const publicKeyBytes = decodeBase58(wallet);
    if (publicKeyBytes.length !== 32 || suppliedSignature.length !== 64) return NextResponse.json({ error: "Invalid signature format." }, { status: 400 });
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyBytes)]), format: "der", type: "spki" });
    const valid = verify(null, Buffer.from(message, "utf8"), publicKey, suppliedSignature);
    if (!valid) return NextResponse.json({ error: "Wallet signature did not verify." }, { status: 401 });
    const consumed = await supabaseRequest<Array<{ wallet: string }>>(`pf_nonces?wallet=eq.${encodeURIComponent(wallet)}&nonce=eq.${encodeURIComponent(nonceRecord.nonce)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
    if (consumed.length !== 1) return NextResponse.json({ error: "Sign-in challenge was already used. Please try again." }, { status: 401 });
    const balance = await getHolderBalance(wallet);
    await setWalletSession(wallet);
    return NextResponse.json({ wallet, balance, eligible: balance.eligible });
  } catch (error) {
    return routeError(error);
  }
}
