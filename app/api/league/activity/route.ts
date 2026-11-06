import { NextResponse } from "next/server";
import { queryRows } from "../../../../lib/server/database";
import { getBackendConfig } from "../../../../lib/server/config";
import { verifyTokenMint } from "../../../../lib/server/solana";
import {
  ACTIVITY_SQL,
  type LeagueActivityData,
} from "../../../../lib/league/activity";
export const dynamic = "force-dynamic";
export async function GET() {
  const config = getBackendConfig();
  const rewardMint = process.env.PF_REWARD_MINT?.trim() || null;
  if (!config.databaseUrl || !config.mint)
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  try {
    const [activity] = await queryRows<
      Omit<LeagueActivityData, "status" | "tokenMint" | "tokenDecimals">
    >(ACTIVITY_SQL, [config.mint, rewardMint]);
    let tokenDecimals: number | null = null;
    if (rewardMint && activity.paidRaw !== "0") {
      try {
        tokenDecimals = (await verifyTokenMint(rewardMint)).decimals;
      } catch {
        /* Do not guess token units. */
      }
    }
    return NextResponse.json(
      {
        ...activity,
        status: "ready",
        tokenMint: config.mint,
        rewardMint,
        rewardSymbol: "PUMP",
        paidRaw: rewardMint ? activity.paidRaw : null,
        tokenDecimals,
      },
      {
        headers: { "Cache-Control": "public, max-age=0, s-maxage=5" },
      },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
