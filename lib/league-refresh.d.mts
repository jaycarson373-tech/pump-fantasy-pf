export function readLeagueSnapshot(options?: { fetcher?: typeof fetch; signal?: AbortSignal }): Promise<{
  players: { players?: { id: string; rank: number; wallet: string; display_name: string | null; profile_url: string | null; avatar_url: string | null; pnl_usd: number; contest_change_usd: number | null }[]; seasonId?: string; snapshotAt?: string; source?: string; live?: boolean } | null;
  standings: { standings?: { wallet: string; score: number | null; scoringReady: boolean }[]; awards?: { id: string; season_id: string; prize_lamports: string; day_number: number; winner_wallet: string | null; status: string; score_usd: number | null; payment_signature: string | null }[]; feePools?: { availableDailyLamports: string; reserveLamports: string; collectedLamports: string } } | null;
  partial: boolean;
}>;
