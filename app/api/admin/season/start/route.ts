import { getBackendConfig } from "../../../../../lib/server/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { queryRows, withAdvisoryLock } from "../../../../../lib/server/database";
import { routeError, sameOrigin } from "../../../../../lib/server/http";
import { saveRosterSnapshot } from "../../../../../lib/server/players";
import { getSeasonPhase, seasonWindowFromOpen } from "../../../../../lib/server/season-window";
import { getSeasonLaunchReadiness } from "../../../../../lib/server/season-launch-readiness";

export const runtime = "nodejs";

function matchesSecret(supplied: string, expected: string) {
  const left = createHmac("sha256", "pf-admin").update(supplied).digest();
  const right = createHmac("sha256", "pf-admin").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const secret = process.env.PF_DATA_INGEST_SECRET;
    const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!secret || !matchesSecret(authorization, secret)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

    const launch = await withAdvisoryLock("pump-fantasy-season-start", async () => {
      const readiness = await getSeasonLaunchReadiness();
      if (!readiness.ready || !readiness.season || !readiness.dailyPrizeLamports || !readiness.observedAt) {
        return NextResponse.json({ error: "Season launch preflight failed.", blockers: readiness.blockers }, { status: 503 });
      }
      const seasonId = readiness.season.id;
      const boardPlayers = readiness.players;
      // Both manual launch and automatic rollover use the same one-hour window.
      const window = seasonWindowFromOpen(Date.now());
      const opensAt = new Date(window.opensAt);
      const lockedAt = new Date(window.lockedAt);
      const closesAt = new Date(window.closesAt);
      const draftMinutes = 60;
      await saveRosterSnapshot(seasonId, boardPlayers, new Date(readiness.observedAt));
      const updated = await queryRows<{ id: string }>("update pf_seasons set status = 'open', opens_at = $2, locked_at = $3, closes_at = $4, daily_prize_lamports = $5, mint_address=$6, prize_mode=$7 where id = $1 and status = 'draft' returning id", [seasonId, opensAt.toISOString(), lockedAt.toISOString(), closesAt.toISOString(), readiness.dailyPrizeLamports, getBackendConfig().mint, process.env.PF_REWARD_MODE === "creator-fees" ? "creator-fees" : "fixed"]);
      if (updated.length !== 1) return NextResponse.json({ error: "Season state changed before launch; refresh the season status and try again." }, { status: 409 });

      return NextResponse.json({
        ok: true,
        seasonId,
        phase: getSeasonPhase({ status: "open", opens_at: opensAt.toISOString(), locked_at: lockedAt.toISOString(), closes_at: closesAt.toISOString() }),
        opensAt: opensAt.toISOString(),
        draftLocksAt: lockedAt.toISOString(),
        seasonEndsAt: closesAt.toISOString(),
        draftMinutes,
        draftHours: draftMinutes / 60,
        scoringHours: 48,
        openingRosterObservedAt: readiness.observedAt,
        openingRosterPlayers: boardPlayers.length,
      });
    });
    if (!launch.acquired) return NextResponse.json({ error: "A season start is already in progress. Check season status before retrying." }, { status: 409 });
    return launch.value;
  } catch (error) {
    return routeError(error);
  }
}
