import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getBackendConfig } from "./config";

const COOKIE_NAME = "pf_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function mac(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export async function setWalletSession(wallet: string) {
  const { sessionSecret } = getBackendConfig();
  if (!sessionSecret) throw new Error("Session signing is not configured.");
  const payload = Buffer.from(JSON.stringify({ wallet, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString("base64url");
  const value = `${payload}.${mac(payload, sessionSecret)}`;
  (await cookies()).set(COOKIE_NAME, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS });
}

export async function clearWalletSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function getWalletSession(): Promise<string | null> {
  const { sessionSecret } = getBackendConfig();
  if (!sessionSecret) return null;
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload, sessionSecret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { wallet?: unknown; exp?: unknown };
    if (typeof decoded.wallet !== "string" || typeof decoded.exp !== "number" || decoded.exp < Date.now() / 1000) return null;
    return decoded.wallet;
  } catch {
    return null;
  }
}
