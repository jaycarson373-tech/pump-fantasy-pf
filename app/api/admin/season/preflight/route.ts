import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sameOrigin } from "../../../../../lib/server/http";
import { getSeasonLaunchReadiness } from "../../../../../lib/server/season-launch-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function matchesSecret(supplied: string, expected: string) {
  const left = createHmac("sha256", "pf-admin").update(supplied).digest();
  const right = createHmac("sha256", "pf-admin").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const secret = process.env.PF_DATA_INGEST_SECRET;
  const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !matchesSecret(authorization, secret)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  try {
    const readiness = await getSeasonLaunchReadiness();
    return NextResponse.json({
      ok: readiness.ready,
      action: "read-only-preflight",
      ready: readiness.ready,
      blockers: readiness.blockers,
      seasonId: readiness.season?.id ?? null,
      seasonStatus: readiness.season?.status ?? null,
      dailyPrizeLamports: readiness.dailyPrizeLamports,
      prizeWallet: readiness.prizeWallet,
      requiredBalanceLamports: readiness.requiredBalanceLamports,
      currentBalanceLamports: readiness.currentBalanceLamports,
      leaderboardPlayers: readiness.players.length,
      leaderboardObservedAt: readiness.observedAt,
      note: "This check does not start the season or send a transaction.",
    }, { status: readiness.ready ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, action: "read-only-preflight", ready: false, blockers: ["Preflight could not complete. Check database, RPC, and service logs."], note: "This check does not start the season or send a transaction." }, { status: 503 });
  }
}
