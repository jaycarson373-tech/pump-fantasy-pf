import "server-only";
import { getBackendConfig } from "./config";
import { getActiveSeasonId, queryRows } from "./database";
import { validWallet } from "./http";
import { fetchPumpLeaderboard, type FantasyPlayer } from "./pumpfun";
import { getNativeSolBalance, verifyTokenMint } from "./solana";
import type { SeasonSchedule } from "./season-window";
import { creatorFeeConfigurationBlockers } from "./creator-fees";
import { getPayoutConfiguration } from "./automatic-payout";

type Season = SeasonSchedule & { id: string; title: string; status: string };

export type SeasonLaunchReadiness = {
  ready: boolean;
  blockers: string[];
  season: Season | null;
  prizeWallet: string | null;
  dailyPrizeLamports: string | null;
  requiredBalanceLamports: string | null;
  currentBalanceLamports: string | null;
  players: FantasyPlayer[];
  observedAt: string | null;
};

const blocked = (blockers: string[]): SeasonLaunchReadiness => ({
  ready: false,
  blockers,
  season: null,
  prizeWallet: null,
  dailyPrizeLamports: null,
  requiredBalanceLamports: null,
  currentBalanceLamports: null,
  players: [],
  observedAt: null,
});

/** Read-only launch gate shared by the operator's preflight and start actions. */
export async function getSeasonLaunchReadiness(): Promise<SeasonLaunchReadiness> {
  const config = getBackendConfig();
  const blockers: string[] = [];
  if (!config.ready) blockers.push("Backend, RPC, session secret, and live FANTASY mint must be configured.");
  try {
    const migrationRows = await queryRows<{ applied: boolean }>("select exists (select 1 from pf_schema_migrations where name = '202610140002_creator_fee_pools.sql') as applied");
    if (!migrationRows[0]?.applied) blockers.push("Apply the creator-fee-pools migration before opening a season.");
  } catch {
    blockers.push("Could not verify the creator-fee-pools migration in the database.");
  }
  if (config.ready && config.mint) {
    try {
      await verifyTokenMint(config.mint);
    } catch {
      blockers.push("The configured FANTASY mint is not initialized on Solana mainnet yet.");
    }
  }
  const feeMode = process.env.PF_REWARD_MODE === "creator-fees";
  const prizeText = feeMode ? "0" : process.env.PF_DAILY_PRIZE_LAMPORTS || "";
  const prizeWallet = process.env.PF_PRIZE_WALLET_ADDRESS || "";
  const payout = await getPayoutConfiguration();
  if (!feeMode && (!/^\d+$/.test(prizeText) || BigInt(prizeText || "0") <= 0n)) blockers.push("Set PF_DAILY_PRIZE_LAMPORTS to the exact positive daily prize in lamports.");
  if (!validWallet(prizeWallet)) blockers.push("Set PF_PRIZE_WALLET_ADDRESS to the public wallet that will fund automatic winner payouts.");
  blockers.push(...payout.blockers);
  if (feeMode) blockers.push(...await creatorFeeConfigurationBlockers());
  if (/^\d+$/.test(prizeText) && BigInt(prizeText || "0") > 0n && payout.perAwardCap && BigInt(prizeText) > payout.perAwardCap) blockers.push("PF_DAILY_PRIZE_LAMPORTS exceeds the configured per-award payout cap.");
  if (/^\d+$/.test(prizeText) && BigInt(prizeText || "0") > 0n && payout.seasonCap && BigInt(prizeText) * 2n > payout.seasonCap) blockers.push("The two daily awards exceed the configured season payout cap.");
  if (blockers.length) return blocked(blockers);

  let season: Season | null = null;
  try {
    const seasonId = await getActiveSeasonId();
    if (!seasonId || !/^[a-zA-Z0-9_-]{1,64}$/.test(seasonId)) {
      blockers.push("The prepared active season row is missing.");
    } else {
      season = (await queryRows<Season>("select id, title, status, opens_at, locked_at, closes_at from pf_seasons where id = $1 limit 1", [seasonId]))[0] ?? null;
      if (!season) blockers.push("The configured season row was not found in the database.");
      else {
        if (season.status !== "draft") blockers.push("Only a draft season can be started; this season is already open or ended.");
        const entries = await queryRows<{ wallet: string }>("select wallet from pf_entries where season_id = $1 limit 1", [seasonId]);
        if (entries.length) blockers.push("This season already has entries; refusing to reset its schedule.");
      }
    }
  } catch {
    blockers.push("Database is unavailable or the season migrations have not been applied.");
  }
  if (blockers.length) return { ...blocked(blockers), season };

  const dailyPrize = BigInt(prizeText);
  const requiredBalance = feeMode ? 5_000_000n : dailyPrize * 2n + 20_000n;
  let currentBalance: bigint;
  try {
    currentBalance = await getNativeSolBalance(prizeWallet);
  } catch {
    return { ...blocked(["Could not verify the prize wallet balance through the configured Solana RPC."]), season, prizeWallet, dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredBalance.toString() };
  }
  if (currentBalance < requiredBalance) {
    blockers.push("Prize wallet needs the required SOL funding (creator-fee mode requires a separate 0.005 SOL gas buffer).");
    return { ...blocked(blockers), season, prizeWallet, dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredBalance.toString(), currentBalanceLamports: currentBalance.toString() };
  }

  let players: FantasyPlayer[];
  let observedAt: string;
  try {
    const board = await fetchPumpLeaderboard(50, { fresh: true });
    players = board.players;
    observedAt = board.snapshotAt;
  } catch {
    return { ...blocked(["Could not fetch the current Pump.fun leaderboard."]), season, prizeWallet, dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredBalance.toString(), currentBalanceLamports: currentBalance.toString() };
  }
  if (players.length !== 50 || players.some((player, index) => player.rank !== index + 1 || !validWallet(player.wallet) || !Number.isFinite(player.pnl_usd)) || new Set(players.map((player) => player.wallet)).size !== 50) {
    blockers.push("Pump.fun must return a complete, unique, consecutive 1–50 leaderboard before opening entries.");
    return { ...blocked(blockers), season, prizeWallet, dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredBalance.toString(), currentBalanceLamports: currentBalance.toString() };
  }

  return {
    ready: true,
    blockers: [],
    season,
    prizeWallet,
    dailyPrizeLamports: prizeText,
    requiredBalanceLamports: requiredBalance.toString(),
    currentBalanceLamports: currentBalance.toString(),
    players,
    observedAt,
  };
}
