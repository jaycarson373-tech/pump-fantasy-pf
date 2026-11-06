import "server-only";
import { createHash } from "node:crypto";
import { validatePool, type Trader, DAY } from "../../league/engine";
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** A trusted operator-configured indexer must attest interval accounting and complete custody coverage. */
export async function provider<T>(
  kind: "rankings" | "pnl" | "eligibility",
  params: Record<string, string>,
): Promise<T> {
  const configured = process.env[`PF_${kind.toUpperCase()}_URL`];
  if (!configured) throw Error(`${kind} data provider is not configured`);
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("Provider must use HTTPS");
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  const response = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json",
      ...(process.env.PF_LEAGUE_DATA_TOKEN
        ? { Authorization: `Bearer ${process.env.PF_LEAGUE_DATA_TOKEN}` }
        : {}),
    },
  });
  if (!response.ok)
    throw Error(`${kind} source unavailable (${response.status})`);
  return response.json();
}
export type RankingEvidence = {
  observedAt: string;
  windowStart: string;
  windowEnd: string;
  sourceUrl: string;
  methodology: string;
  screeningPolicy: string;
  excludedWallets: string[];
  players: Trader[];
};
export function rankingsEvidence(data: RankingEvidence, opensAt: string) {
  const observed = Date.parse(data.observedAt),
    end = Date.parse(data.windowEnd),
    start = Date.parse(data.windowStart),
    opens = Date.parse(opensAt);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(end) ||
    !Number.isFinite(start) ||
    observed > opens ||
    opens - observed > 60 * 60_000 ||
    end > observed ||
    observed - end > 60 * 60_000 ||
    end - start !== 30 * DAY ||
    !data.methodology ||
    !data.screeningPolicy ||
    !data.sourceUrl.startsWith("https://") ||
    !Array.isArray(data.excludedWallets)
  )
    throw Error(
      "A verifiable 30-day ranking snapshot at the draft boundary is required",
    );
  const players = validatePool(data.players);
  if (players.some((p) => data.excludedWallets.includes(p.wallet)))
    throw Error("Ineligible wallet in draft pool");
  return players;
}
export type IntervalEvidence = {
  start: string;
  end: string;
  sourceUrl: string;
  methodology: string;
  transfersExcluded: boolean;
  deduplicated: boolean;
  complete: boolean;
  pnl: Record<string, string>;
};
export function intervalEvidence(
  data: IntervalEvidence,
  start: string,
  end: string,
  methodology: string,
) {
  if (
    Date.parse(data.start) !== Date.parse(start) ||
    Date.parse(data.end) !== Date.parse(end) ||
    data.methodology !== methodology ||
    !data.transfersExcluded ||
    !data.deduplicated ||
    !data.complete ||
    !data.sourceUrl.startsWith("https://")
  )
    throw Error("Complete exact-interval net PnL evidence required");
  return data.pnl;
}
export type CoverageEvidence = {
  wallet: string;
  mint: string;
  start: string;
  end: string;
  minimumBalanceRaw: string;
  decimals: number;
  complete: boolean;
  sourceUrl: string;
};
