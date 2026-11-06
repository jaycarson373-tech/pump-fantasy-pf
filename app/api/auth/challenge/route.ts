import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../../lib/server/config";
import { queryRows } from "../../../../lib/server/database";
import { routeError, sameOrigin, validWallet } from "../../../../lib/server/http";
import { siteOrigin } from "../../../../lib/server/origin.mjs";
import { walletNetwork } from "../../../../lib/wallet-network";

export const runtime = "nodejs";
const NONCE_BYTES = 24;
const CHALLENGE_TTL_MS = 5 * 60_000;

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const { wallet } = await request.json();
    if (!validWallet(wallet)) return NextResponse.json({ error: "Enter a valid Solana wallet address." }, { status: 400 });
    const config = getBackendConfig();
    if (!config.ready) return NextResponse.json({ error: "Wallet sign-in and holder checks are not configured yet.", code: "NOT_CONFIGURED" }, { status: 503 });
    const origin = siteOrigin(request);
    if (!origin) return NextResponse.json({ error: "This site origin is not allowed." }, { status: 403 });
    const nonce = randomBytes(NONCE_BYTES).toString("hex");
    const issuedAt = new Date();
    const expires = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS).toISOString();
    const chain = walletNetwork(process.env.NEXT_PUBLIC_WALLET_NETWORK).chain;
    await queryRows("insert into pf_nonces (wallet, nonce, expires_at) values ($1, $2, $3) on conflict (wallet) do update set nonce = excluded.nonce, expires_at = excluded.expires_at", [wallet, nonce, expires]);
    const siteHost = new URL(origin).host;
    const message = `${siteHost} wants you to sign in with your Solana account:\n${wallet}\n\nSign this one-time message to verify wallet ownership. No transaction will be sent.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${chain}\nNonce: ${nonce}\nIssued At: ${issuedAt.toISOString()}\nExpiration Time: ${expires}`;
    return NextResponse.json({ message });
  } catch (error) {
    return routeError(error);
  }
}
