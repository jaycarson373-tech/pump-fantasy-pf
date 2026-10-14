import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { queryRows } from "../../../../../lib/server/database";
import { routeError, sameOrigin, validWallet } from "../../../../../lib/server/http";
import { verifyNativeSolTransfer } from "../../../../../lib/server/solana";

export const runtime = "nodejs";

function secretMatches(supplied: string, expected: string) {
  const left = createHmac("sha256", "pf-award").update(supplied).digest();
  const right = createHmac("sha256", "pf-award").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    if (process.env.PF_AUTO_PAYOUT_ENABLED === "true") return NextResponse.json({ error: "Automatic payouts are enabled; manual award verification is disabled." }, { status: 409 });
    const secret = process.env.PF_DATA_INGEST_SECRET;
    const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!secret || !secretMatches(authorization, secret)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    const body = await request.json() as { awardId?: unknown; signature?: unknown };
    if (typeof body.awardId !== "string" || typeof body.signature !== "string") return NextResponse.json({ error: "Provide an award ID and confirmed transaction signature." }, { status: 400 });
    const rows = await queryRows<{ id: string; winner_wallet: string | null; prize_lamports: string; status: string; payment_signature: string | null }>("select id, winner_wallet, prize_lamports, status, payment_signature from pf_daily_awards where id = $1 limit 1", [body.awardId]);
    const award = rows[0];
    if (!award) return NextResponse.json({ error: "Award not found." }, { status: 404 });
    if (award.status === "paid") return NextResponse.json({ error: "This award is already marked paid.", signature: award.payment_signature }, { status: 409 });
    if (!award.winner_wallet || !validWallet(award.winner_wallet) || BigInt(award.prize_lamports) <= 0n) return NextResponse.json({ error: "This award has no eligible winner or configured prize amount." }, { status: 409 });
    const prizeWallet = process.env.PF_PRIZE_WALLET_ADDRESS || "";
    if (!validWallet(prizeWallet)) return NextResponse.json({ error: "The prize wallet is not configured for payment verification." }, { status: 503 });
    const verified = await verifyNativeSolTransfer(body.signature, prizeWallet, award.winner_wallet, award.prize_lamports);
    if (!verified) return NextResponse.json({ error: "The transaction is not a confirmed successful SOL transfer for the exact award amount and winner." }, { status: 422 });
    const updated = await queryRows<{ id: string }>("update pf_daily_awards set status = 'paid', payment_signature = $2, paid_at = now() where id = $1 and status = 'pending_payment' returning id", [award.id, body.signature]);
    if (!updated.length) return NextResponse.json({ error: "Award status changed while verifying. Refresh and check again." }, { status: 409 });
    return NextResponse.json({ ok: true, awardId: award.id, winner: award.winner_wallet, lamports: award.prize_lamports, signature: body.signature, slot: verified.slot });
  } catch (error) {
    return routeError(error);
  }
}
