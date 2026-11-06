import "server-only";
import { address } from "@solana/kit";
import { parseCommunityPnl, parseCommunityProfile } from "../community-data";
import { queryRows } from "./database";

const HOST = "https://frontend-api-v3.pump.fun";
const MAX_BYTES = 256_000;
const TIMEOUT_MS = 10_000;
export async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("Pump.fun data is unavailable. No burn was prepared; try again later.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > MAX_BYTES) throw new Error("Provider response exceeded its limit. Try again later.");
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel(); }
}

async function publicRead(path: string) {
  // Durable global budget: all app replicas share the same public-source ceiling.
  const claim = await queryRows("update pf_community_source_budget set calls=case when day=current_date then calls+1 else 1 end,day=current_date,next_call=clock_timestamp()+interval '500 milliseconds' where id=1 and next_call<=clock_timestamp() and (day<>current_date or calls<40000) returning id");
  if (!claim.length) throw new Error("Player data is busy. Wait a moment and retry.");
  const response = await fetch(HOST + path, { headers: { Accept: "application/json", Origin: "https://pump.fun" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  return boundedJson(response);
}

export async function fetchCommunityPnl(wallet: string) {
  address(wallet);
  const [cached] = await queryRows<{ observation: unknown }>("select observation from pf_community_pnl_cache where wallet=$1 and next_attempt>clock_timestamp()", [wallet]);
  if (cached?.observation) return parseCommunityPnl(cached.observation, wallet);
  const claim = await queryRows("insert into pf_community_pnl_cache(wallet,next_attempt) values($1,clock_timestamp()+interval '30 seconds') on conflict(wallet) do update set next_attempt=excluded.next_attempt where pf_community_pnl_cache.next_attempt<=clock_timestamp() returning wallet", [wallet]);
  if (!claim.length) throw new Error("Player data is refreshing. Wait a moment and retry.");
  await new Promise(resolve => setTimeout(resolve, 550));
  const data = await publicRead(`/portfolio-summary?${new URLSearchParams({ user: wallet, period: "all" })}`);
  const result = parseCommunityPnl(data, wallet);
  await queryRows("update pf_community_pnl_cache set observation=$2::jsonb where wallet=$1", [wallet,JSON.stringify(data)]);
  return result;
}

export async function fetchCommunityProfile(wallet: string) {
  address(wallet);
  const profile = parseCommunityProfile(await publicRead(`/users/${wallet}`), wallet);
  return { ...profile, ...await fetchCommunityPnl(wallet) };
}
