import test from "node:test";
import assert from "node:assert/strict";
import { sameSiteOrigin, siteOriginHost } from "../lib/server/origin.mjs";

const env = {
  NEXT_PUBLIC_SITE_URL: "https://www.pumpfunfantasy.xyz",
  PUMP_FANTASY_ALLOWED_ORIGINS: "https://pump-fantasy-pf.vercel.app",
};

function post(origin, headers = {}) {
  return new Request("https://pump-fantasy-pf-production.up.railway.app/api/auth/challenge", {
    method: "POST",
    headers: { ...(origin ? { origin } : {}), ...headers },
  });
}

test("accepts the canonical site origin behind the Railway API proxy", () => {
  const request = post("https://www.pumpfunfantasy.xyz");
  assert.equal(sameSiteOrigin(request, env), true);
  assert.equal(siteOriginHost(request, env), "www.pumpfunfantasy.xyz");
});

test("accepts the explicitly allowed Vercel project origin and binds the challenge to it", () => {
  const request = post("https://pump-fantasy-pf.vercel.app");
  assert.equal(sameSiteOrigin(request, env), true);
  assert.equal(siteOriginHost(request, env), "pump-fantasy-pf.vercel.app");
});

test("includes this repo's stable Vercel project domain without a Railway override", () => {
  const request = post("https://pump-fantasy-pf.vercel.app");
  assert.equal(sameSiteOrigin(request, { NEXT_PUBLIC_SITE_URL: "https://www.pumpfunfantasy.xyz" }), true);
});

test("rejects unlisted origins even when a forwarded-host header is forged", () => {
  const request = post("https://attacker.example", { "x-forwarded-host": "www.pumpfunfantasy.xyz" });
  assert.equal(sameSiteOrigin(request, env), false);
  assert.equal(siteOriginHost(request, env), null);
});

test("does not treat an HTTP origin as equivalent to its HTTPS allowlist entry", () => {
  assert.equal(sameSiteOrigin(post("http://pump-fantasy-pf.vercel.app"), env), false);
});

test("keeps same-origin direct requests and originless server calls working", () => {
  const local = new Request("http://localhost:3000/api/auth/challenge", { method: "POST", headers: { origin: "http://localhost:3000" } });
  assert.equal(sameSiteOrigin(local, {}), true);
  assert.equal(sameSiteOrigin(post(null), env), true);
});
