import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { routeError } from "../../../../lib/server/http";
import { tickSeason } from "../../../../lib/server/season-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(supplied: string, expected: string) {
  const a = createHmac("sha256", "pf-cron").update(supplied).digest();
  const b = createHmac("sha256", "pf-cron").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  try {
    const expected = process.env.PF_DATA_INGEST_SECRET;
    const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!expected || !secretMatches(supplied, expected)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
    return NextResponse.json(await tickSeason());
  } catch (error) {
    return routeError(error);
  }
}
