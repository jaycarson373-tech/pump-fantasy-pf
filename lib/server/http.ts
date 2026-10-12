import { NextResponse } from "next/server";
import { BackendNotConfigured } from "./config";

export function routeError(error: unknown) {
  if (error instanceof BackendNotConfigured) return NextResponse.json({ error: error.message, code: "NOT_CONFIGURED" }, { status: 503 });
  const message = error instanceof Error ? error.message : "Request failed.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function validWallet(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 32 || value.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}
