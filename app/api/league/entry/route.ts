import { NextResponse } from "next/server";
import { getWalletSession } from "../../../../lib/server/session";
import { sameOrigin } from "../../../../lib/server/http";
import { submitRoster } from "../../../../lib/server/league/service";
export async function PUT(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  const wallet = await getWalletSession();
  if (!wallet)
    return NextResponse.json(
      { error: "Sign in with your wallet first" },
      { status: 401 },
    );
  try {
    const body = await request.json();
    if (
      typeof body.roundId !== "string" ||
      typeof body.captain !== "string" ||
      !Array.isArray(body.picks) ||
      body.picks.some((p: unknown) => typeof p !== "string")
    )
      return NextResponse.json({ error: "Invalid lineup" }, { status: 400 });
    return NextResponse.json({
      ok: true,
      roster: await submitRoster(
        body.roundId,
        wallet,
        body.picks,
        body.captain,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not save lineup",
      },
      { status: 409 },
    );
  }
}
