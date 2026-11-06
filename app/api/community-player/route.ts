import { NextResponse } from "next/server";
import { sameOrigin } from "../../../lib/server/http";
import { getWalletSession } from "../../../lib/server/session";
import { fetchCommunityProfile } from "../../../lib/server/community-data";
import { record } from "../../../lib/community-data";
import { playerStatus, throttlePlayerRequest, prepareCommunityPlayer, submitCommunityBurn, confirmCommunityBurn } from "../../../lib/server/community-player";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY = 4_096;
function failure(error: unknown) {
  // Never relay unknown provider/SQL errors or credential-bearing URLs.
  const text = error instanceof Error ? error.message : "";
  const safe = /^(Your |Connect |Set a Pump|Fresh player|Player PnL|Pump.fun data|Player data|Please wait|Hold 500|A different receipt|No |The burn quote|This burn changed|The transaction expired)/.test(text);
  return NextResponse.json({ error: safe ? text : "Player registration is unavailable. Keep any pending receipt and retry later." }, { status: 503 });
}
export async function GET() {
  try {
    const wallet = await getWalletSession();
    if (!wallet) return NextResponse.json({ player: null, pending: null });
    return NextResponse.json(await playerStatus(wallet));
  } catch (error) { return failure(error); }
}
async function body(request: Request) {
  if (!request.body) throw new Error("Missing player action.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > MAX_BODY) throw new Error("Player action too large.");
      chunks.push(part.value);
    }
    return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally { await reader.cancel(); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    const wallet = await getWalletSession();
    if (!wallet) return NextResponse.json({ error: "Connect and verify your wallet first." }, { status: 401 });
    const input = await body(request);
    if (!["preview", "prepare", "submit", "confirm"].includes(String(input.action))) return NextResponse.json({ error: "Unknown player action." }, { status: 400 });
    await throttlePlayerRequest(`${wallet}:${input.action}`);
    if (input.action === "preview") return NextResponse.json({ profile: await fetchCommunityProfile(wallet) });
    if (input.action === "prepare") return NextResponse.json(await prepareCommunityPlayer(wallet));
    if (typeof input.id !== "string" || !/^[a-f0-9-]{36}$/.test(input.id)) return NextResponse.json({ error: "Open your player registration to retrieve its burn reference." }, { status: 400 });
    if (input.action === "submit") return NextResponse.json(await submitCommunityBurn(wallet,input.id,input.wire));
    if (input.action === "confirm") return NextResponse.json(await confirmCommunityBurn(wallet,input.id));
    return NextResponse.json({ error: "Unknown player action." }, { status: 400 });
  } catch (error) { return failure(error); }
}
