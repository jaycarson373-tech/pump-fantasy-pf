import { NextResponse } from "next/server";
import { getWalletSession } from "../../../../lib/server/session";
import { sameOrigin } from "../../../../lib/server/http";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  if (!(await getWalletSession()))
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json(
    {
      error:
        "PFL reward settlement is not activated. No claim or transaction was created.",
      code: "PAYOUT_REVIEW_REQUIRED",
    },
    { status: 503 },
  );
}
