export type ScoringEntry = { wallet: string; picks: string[] };
export type ScoringPlayer = { id: string; wallet: string };

export type DailyWinnerResult =
  | { kind: "no-eligible-entries" }
  | { kind: "awaiting-data" }
  | { kind: "winner"; wallet: string; score: number };

/** Select the daily winner from complete start/end PnL snapshots only. */
export function calculateDailyWinner(
  entries: ScoringEntry[],
  players: ScoringPlayer[],
  previousPnl: Record<string, number>,
  currentPnl: Record<string, number>,
): DailyWinnerResult {
  if (!entries.length) return { kind: "no-eligible-entries" };

  const walletById = new Map(players.map((player) => [player.id, player.wallet]));
  const totals: Array<{ wallet: string; score: number }> = [];

  for (const entry of entries) {
    if (entry.picks.length !== 5 || new Set(entry.picks).size !== 5) return { kind: "awaiting-data" };
    const pickedWallets = entry.picks.map((id) => walletById.get(id));
    if (pickedWallets.some((wallet) => !wallet)) return { kind: "awaiting-data" };

    let score = 0;
    for (const wallet of pickedWallets as string[]) {
      const before = previousPnl[wallet];
      const after = currentPnl[wallet];
      if (!Number.isFinite(before) || !Number.isFinite(after)) return { kind: "awaiting-data" };
      score += after - before;
    }
    totals.push({ wallet: entry.wallet, score });
  }

  totals.sort((a, b) => b.score - a.score || a.wallet.localeCompare(b.wallet));
  return { kind: "winner", wallet: totals[0].wallet, score: totals[0].score };
}
