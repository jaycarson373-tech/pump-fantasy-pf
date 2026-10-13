import { NextResponse } from "next/server";
import { queryRows } from "../../../../lib/server/database";
import { routeError, sameOrigin, validWallet } from "../../../../lib/server/http";
import { verifyNativeSolTransfer } from "../../../../lib/server/solana";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const body = await request.json() as { awardId?: unknown; signature?: unknown };
    if (typeof body.awardId !== "string" || typeof body.signature !== "string") return NextResponse.json({ error: "Provide an award ID and confirmed transaction signature." }, { status: 400 });
    const rows = await queryRows<{ id: string; winner_wallet: string | null; prize_lamports: string; status: string; payment_signature: string | null }>("select id, winner_wallet, prize_lamports, status, payment_signature from pf_daily_awards where id = $1 limit 1", [body.awardId]);
    const award = rows[0];
    if (!award) return NextResponse.json({ error: "Award not found." }, { status: 404 });
    if (award.status === "paid") return NextResponse.json({ ok: true, signature: award.payment_signature, alreadyPaid: true });
    if (!award.winner_wallet || !validWallet(award.winner_wallet) || BigInt(award.prize_lamports) <= 0n) return NextResponse.json({ error: "This award has no eligible winner or configured prize amount." }, { status: 409 });
    const prizeWallet = process.env.PF_PRIZE_WALLET_ADDRESS || "";
    if (!validWallet(prizeWallet)) return NextResponse.json({ error: "The prize wallet is not configured for payment verification." }, { status: 503 });
    let verified = null;
    for (let attempt = 0; attempt < 6 && !verified; attempt += 1) {
      verified = await verifyNativeSolTransfer(body.signature, prizeWallet, award.winner_wallet, award.prize_lamports);
      if (!verified && attempt < 5) await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    if (!verified) return NextResponse.json({ error: "The transaction is not a confirmed successful SOL transfer for the exact award amount and winner. Check the signature and retry." }, { status: 422 });
    const updated = await queryRows<{ id: string }>("update pf_daily_awards set status = 'paid', payment_signature = $2, paid_at = now() where id = $1 and status = 'pending_payment' returning id", [award.id, body.signature]);
    if (!updated.length) return NextResponse.json({ error: "Award status changed while verifying. Refresh and check again." }, { status: 409 });
    return NextResponse.json({ ok: true, awardId: award.id, winner: award.winner_wallet, lamports: award.prize_lamports, signature: body.signature, slot: verified.slot });
  } catch (error) {
    return routeError(error);
  }
}
