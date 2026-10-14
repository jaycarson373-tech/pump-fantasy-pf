import { NextResponse } from "next/server";
import { BackendNotConfigured } from "./config";
import { sameSiteOrigin } from "./origin.mjs";

export function routeError(error: unknown) {
  if (error instanceof BackendNotConfigured) return NextResponse.json({ error: error.message, code: "NOT_CONFIGURED" }, { status: 503 });
  const message = error instanceof Error ? error.message : "Request failed.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export function sameOrigin(request: Request) {
  return sameSiteOrigin(request);
}

export function validWallet(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}
