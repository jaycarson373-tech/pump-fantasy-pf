import "server-only";

const LEADERBOARD_URL = "https://frontend-api-v3.pump.fun/pnl-leaderboard";

type PumpLeaderboardRow = {
  rank: number;
  walletAddress: string;
  username?: string | null;
  profileImage?: string | null;
  pnlUsd: number;
  lastRefreshedAtMs?: number;
};

export type FantasyPlayer = {
  id: string;
  rank: number;
  wallet: string;
  display_name: string | null;
  profile_url: string;
  avatar_url: string | null;
  pnl_usd: number;
};

export async function fetchPumpLeaderboard(limit = 50, options: { fresh?: boolean } = {}) {
  const url = new URL(LEADERBOARD_URL);
  url.search = new URLSearchParams({ period: "monthly", sort: "combined", limit: String(Math.min(100, Math.max(50, limit))) }).toString();
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: options.fresh ? "no-store" : "force-cache",
    ...(options.fresh ? {} : { next: { revalidate: 30 } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Pump.fun leaderboard returned HTTP ${response.status}.`);
  const data = (await response.json()) as { entries?: PumpLeaderboardRow[] };
  if (!Array.isArray(data.entries)) throw new Error("Pump.fun returned an invalid leaderboard response.");
  const entries = data.entries
    .filter((row) => Number.isInteger(row.rank) && typeof row.walletAddress === "string" && Number.isFinite(row.pnlUsd))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.min(100, Math.max(50, limit)));
  if (entries.length < 50) throw new Error("Pump.fun returned fewer than 50 ranked traders.");
  const observedAtMs = Math.max(...entries.map((row) => row.lastRefreshedAtMs ?? 0));
  const players: FantasyPlayer[] = entries.map((row) => ({
    id: `rank-${String(row.rank).padStart(2, "0")}`,
    rank: row.rank,
    wallet: row.walletAddress,
    display_name: row.username ?? null,
    profile_url: `https://pump.fun/profile/${encodeURIComponent(row.walletAddress)}`,
    avatar_url: typeof row.profileImage === "string" && row.profileImage.startsWith("https://") ? row.profileImage : null,
    pnl_usd: row.pnlUsd,
  }));
  return { players, snapshotAt: observedAtMs ? new Date(observedAtMs).toISOString() : new Date().toISOString() };
}
