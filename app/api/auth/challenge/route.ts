import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getBackendConfig, supabaseRequest } from "../../../../lib/server/config";
import { routeError, sameOrigin, validWallet } from "../../../../lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const { wallet } = await request.json();
    if (!validWallet(wallet)) return NextResponse.json({ error: "Enter a valid Solana wallet address." }, { status: 400 });
    const config = getBackendConfig();
    if (!config.ready) return NextResponse.json({ error: "Wallet sign-in and holder checks are not configured yet.", code: "NOT_CONFIGURED" }, { status: 503 });
    const nonce = randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 5 * 60_000).toISOString();
    await supabaseRequest("pf_nonces?on_conflict=wallet", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ wallet, nonce, expires_at: expires }]),
    });
    const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const message = `${new URL(site).host} wants you to sign in with your Solana account:\n${wallet}\n\nSign this one-time message to verify wallet ownership. No transaction will be sent.\n\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expires}`;
    return NextResponse.json({ message });
  } catch (error) {
    return routeError(error);
  }
}
