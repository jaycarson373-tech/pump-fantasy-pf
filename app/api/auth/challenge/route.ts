import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../../lib/server/config";
import { queryRows } from "../../../../lib/server/database";
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
    await queryRows("insert into pf_nonces (wallet, nonce, expires_at) values ($1, $2, $3) on conflict (wallet) do update set nonce = excluded.nonce, expires_at = excluded.expires_at", [wallet, nonce, expires]);
    const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const message = `${new URL(site).host} wants you to sign in with your Solana account:\n${wallet}\n\nSign this one-time message to verify wallet ownership. No transaction will be sent.\n\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expires}`;
    return NextResponse.json({ message });
  } catch (error) {
    return routeError(error);
  }
}
