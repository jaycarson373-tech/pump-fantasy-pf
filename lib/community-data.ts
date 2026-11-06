/** Pump.fun public profile/portfolio contract, docs.pump.fun/openapi.public.json (2026-11-06). */
export type CommunityProfile = { wallet: string; display_name: string; avatar_url: string | null; profile_url: string; pnl_usd: number; observedAt: string };
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid provider response. Retry when the data source is available.");
  return value as Record<string, unknown>;
}
export function parseCommunityProfile(value: unknown, wallet: string) {
  const row = record(value);
  const canonical = row.canonical_svm_wallet ?? row.address;
  if (canonical !== wallet || row.is_pump_user !== true || row.kind === "group")
    throw new Error("Connect the canonical Solana wallet of your own Pump.fun account, then retry.");
  if (typeof row.username !== "string" || !row.username.trim() || row.username.length > 100)
    throw new Error("Set a Pump.fun username before creating your player.");
  const image = typeof row.profile_image === "string" && row.profile_image.length <= 2048 ? row.profile_image : "";
  let avatar: string | null = null;
  try { const url = new URL(image); if (url.protocol === "https:" && !url.username && !url.password) avatar = url.href; } catch { /* A profile image is optional. */ }
  return { wallet, display_name: row.username, avatar_url: avatar, profile_url: `https://pump.fun/profile/${wallet}` };
}
export function parseCommunityPnl(value: unknown, wallet: string, now = Date.now()) {
  const row = record(value);
  const pnl = record(row.pnl).usd;
  const stamp = row.computedAt;
  const maxAge = 120_000;
  const futureTolerance = 5_000;
  if (row.wallet !== wallet || typeof pnl !== "number" || !Number.isFinite(pnl)
    || typeof stamp !== "number" || !Number.isFinite(stamp) || stamp < now - maxAge || stamp > now + futureTolerance)
    throw new Error("Fresh player PnL is unavailable. No burn will be prepared; try again later.");
  if (!Array.isArray(row.missingPriceMints) || row.missingPriceMints.length)
    throw new Error("Player PnL has missing price data. Wait for Pump.fun to update it.");
  return { pnl_usd: pnl, observedAt: new Date(stamp).toISOString() };
}
