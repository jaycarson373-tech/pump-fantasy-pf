import { NextResponse } from "next/server";
import { getWalletSession } from "../../../lib/server/session";
import { leagueState } from "../../../lib/server/league/read-model";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await leagueState(
        await getWalletSession(),
        new URL(request.url).searchParams.get("round"),
      ),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        message: "League data is temporarily unavailable. Try again shortly.",
      },
      { status: 503 },
    );
  }
}
