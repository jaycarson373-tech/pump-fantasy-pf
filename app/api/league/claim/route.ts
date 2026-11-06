import { NextResponse } from "next/server";
import { getWalletSession } from "../../../../lib/server/session";
import { sameOrigin } from "../../../../lib/server/http";
import { claimEntitlement } from "../../../../lib/server/league/claims";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  const wallet = await getWalletSession();
  if (!wallet) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid claim request" }, { status: 400 }); }
  if (!body || typeof body.entitlementId !== "string" || !UUID.test(body.entitlementId))
    return NextResponse.json({ error: "Select a valid entitlement" }, { status: 400 });
  try { return NextResponse.json(await claimEntitlement(body.entitlementId, wallet)); }
  catch { return NextResponse.json({ error: "Claim could not be completed. Check its recorded status before retrying." }, { status: 409 }); }
}
