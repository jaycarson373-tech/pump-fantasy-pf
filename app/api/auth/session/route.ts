import { NextResponse } from "next/server";
import { getBackendConfig } from "../../../../lib/server/config";
import { routeError } from "../../../../lib/server/http";
import { clearWalletSession, getWalletSession } from "../../../../lib/server/session";
import { getHolderBalance } from "../../../../lib/server/solana";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!getBackendConfig().ready) return NextResponse.json({ configured: false, authenticated: false, eligible: false });
    const wallet = await getWalletSession();
    if (!wallet) return NextResponse.json({ configured: true, authenticated: false, eligible: false });
    const balance = await getHolderBalance(wallet);
    return NextResponse.json({ configured: true, authenticated: true, wallet, balance, eligible: balance.eligible });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE() {
  try {
    await clearWalletSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
