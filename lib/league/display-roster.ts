import snapshot from "../../data/pumpfun-one-month-top100.json" with { type: "json" };
import type { Trader } from "./engine";

// Public leaderboard data is for browsing, never contest/scoring evidence.
export type DisplayTrader = Omit<Trader, "trades"> & { trades: number | null };
export const savedRoster: { players: DisplayTrader[]; snapshotAt: string } = snapshot;

export function displayRoster(players?: DisplayTrader[]) {
  if (players?.length === 100) return { players, preview: false };
  return { players: savedRoster.players, preview: true };
}
