import { leagueControlStatus } from "../../../../lib/server/league/control-status";
import { openTestRound } from "../../../../lib/server/league/test-round";
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  createSeason,
  tickLeague,
} from "../../../../lib/server/league/service";
export async function POST(request: Request) {
  const expected = process.env.PF_DATA_INGEST_SECRET;
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (
    !expected ||
    !timingSafeEqual(
      createHash("sha256").update(expected).digest(),
      createHash("sha256").update(supplied).digest(),
    )
  )
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (body.action === "status")
      return NextResponse.json(leagueControlStatus(), { headers: { "Cache-Control": "no-store" } });
    if (body.action === "create-season")
      return NextResponse.json(await createSeason(body));
    if (body.action === "open-test-round")
      return NextResponse.json(await openTestRound(body.id));
    if (body.action === "tick") return NextResponse.json(await tickLeague());
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Operation failed" },
      { status: 409 },
    );
  }
}
