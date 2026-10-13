import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { queryRows, withAdvisoryLock } from "../../../../../lib/server/database";
import { routeError, sameOrigin } from "../../../../../lib/server/http";
import { saveRosterSnapshot } from "../../../../../lib/server/players";
import { getSeasonPhase } from "../../../../../lib/server/season-window";
import { getSeasonLaunchReadiness } from "../../../../../lib/server/season-launch-readiness";

export const runtime = "nodejs";

const DEFAULT_DRAFT_MINUTES = 180;
const MAX_DRAFT_MINUTES = 180;

function parseDraftLockTime(value: unknown, opensAt: Date): Date | null {
  if (value === undefined) return new Date(opensAt.getTime() + DEFAULT_DRAFT_MINUTES * 60_000);
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const minutesUntilLock = (timestamp - opensAt.getTime()) / 60_000;
  if (minutesUntilLock < 1 || minutesUntilLock > MAX_DRAFT_MINUTES) return null;
  return new Date(timestamp);
}

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

    let requestedLockTime: unknown;
    try {
      const body = await request.json();
      requestedLockTime = body && typeof body === "object" && !Array.isArray(body) ? (body as { draftLocksAt?: unknown }).draftLocksAt : undefined;
    } catch {
      // Empty request bodies preserve the existing three-hour default.
    }

    const launch = await withAdvisoryLock("pump-fantasy-season-start", async () => {
      const readiness = await getSeasonLaunchReadiness();
      if (!readiness.ready || !readiness.season || !readiness.dailyPrizeLamports || !readiness.observedAt) {
        return NextResponse.json({ error: "Season launch preflight failed.", blockers: readiness.blockers }, { status: 503 });
      }
      const seasonId = readiness.season.id;
      const boardPlayers = readiness.players;
      const opensAt = new Date();
      const lockedAt = parseDraftLockTime(requestedLockTime, opensAt);
      if (!lockedAt) {
        return NextResponse.json({ error: "draftLocksAt must be an ISO-8601 timestamp with a timezone, between 1 minute and 3 hours from now." }, { status: 400 });
      }
      const draftMinutes = Math.round((lockedAt.getTime() - opensAt.getTime()) / 60_000);
      const closesAt = new Date(lockedAt.getTime() + 48 * 60 * 60 * 1000);
      await saveRosterSnapshot(seasonId, boardPlayers, new Date(readiness.observedAt));
      const updated = await queryRows<{ id: string }>("update pf_seasons set status = 'open', opens_at = $2, locked_at = $3, closes_at = $4, daily_prize_lamports = $5 where id = $1 and status = 'draft' returning id", [seasonId, opensAt.toISOString(), lockedAt.toISOString(), closesAt.toISOString(), readiness.dailyPrizeLamports]);
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
