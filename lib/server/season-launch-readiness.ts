import { COMMUNITY_FETCH_LIMIT, squadSizeForSeason } from "../community-roster";
import "server-only";
import { getBackendConfig } from "./config";
import { getActiveSeasonId, queryRows } from "./database";
import { validWallet } from "./http";
import type { FantasyPlayer } from "./pumpfun";
import { getDraftRoster } from "./roster-cache";
import { getNativeSolBalance, verifyTokenMint } from "./solana";
import type { SeasonSchedule } from "./season-window";
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
  const feeMode = process.env.PF_REWARD_MODE === "creator-fees";
  const blockers: string[] = [];
  if (!config.ready || !validWallet(config.mint || "")) blockers.push("Configure the backend, RPC, session secret and valid FANTASY mint address before opening the draft.");
  try {
    const migrationRows = await queryRows<{ applied: boolean }>("select count(*)=5 as applied from pf_schema_migrations where name in ('202610140002_creator_fee_pools.sql','202611060001_season_fee_rewards.sql','202611060002_saved_draft_roster.sql','202611060004_community_players.sql','202611060005_sixth_slot.sql')");
    if (!migrationRows[0]?.applied) blockers.push("Apply the creator-fee, season-reward, roster-cache, community-player and sixth-slot migrations before opening a season.");
  } catch {
    blockers.push("Could not verify the required season and community-player migrations in the database.");
  }
  // Creator-fee drafts may open before mint creation. Holder checks still verify
  // the mint and balance on every submission; collection/payouts keep their gates.
  if (!feeMode && config.ready && config.mint) {
    try {
      await verifyTokenMint(config.mint);
    } catch {
      blockers.push("The configured FANTASY mint is not initialized on Solana mainnet yet.");
    }
  }
  const prizeText = feeMode ? "0" : process.env.PF_DAILY_PRIZE_LAMPORTS || "";
  const prizeWallet = process.env.PF_PRIZE_WALLET_ADDRESS || "";
  const payout = feeMode ? null : await getPayoutConfiguration();
  if (!feeMode && (!/^\d+$/.test(prizeText) || BigInt(prizeText || "0") <= 0n)) blockers.push("Set PF_DAILY_PRIZE_LAMPORTS to the exact positive daily prize in lamports.");
  if (!validWallet(prizeWallet)) blockers.push("Set PF_PRIZE_WALLET_ADDRESS to the public wallet that will fund automatic winner payouts.");
  if (payout) blockers.push(...payout.blockers);
  if (/^\d+$/.test(prizeText) && BigInt(prizeText || "0") > 0n && payout?.perAwardCap && BigInt(prizeText) > payout.perAwardCap) blockers.push("PF_DAILY_PRIZE_LAMPORTS exceeds the configured per-award payout cap.");
  if (/^\d+$/.test(prizeText) && BigInt(prizeText || "0") > 0n && payout?.seasonCap && BigInt(prizeText) * 2n > payout.seasonCap) blockers.push("The two daily awards exceed the configured season payout cap.");
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
  const requiredBalance = feeMode ? 0n : dailyPrize * 2n + 20_000n;
  let currentBalance: bigint | null = null;
  try {
    if (!feeMode) currentBalance = await getNativeSolBalance(prizeWallet);
  } catch {
    return { ...blocked(["Could not verify the prize wallet balance through the configured Solana RPC."]), season, prizeWallet, dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredBalance.toString() };
  }
  if (currentBalance !== null && currentBalance < requiredBalance) {
    blockers.push("Prize wallet needs the required SOL funding before opening a fixed-prize season.");
    return { ...blocked(blockers), season, prizeWallet, dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredBalance.toString(), currentBalanceLamports: currentBalance?.toString() ?? null };
  }

  let players: FantasyPlayer[];
  let observedAt: string;
  try {
    const board = await getDraftRoster();
    players = board.players;
    observedAt = board.snapshotAt;
  } catch {
    return { ...blocked(["Could not load the saved draft roster. Restore its 50-player snapshot before opening."]), season, prizeWallet, dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredBalance.toString(), currentBalanceLamports: currentBalance?.toString() ?? null };
  }
  if (players.length !== 50 || players.some((player, index) => player.rank !== index + 1 || !validWallet(player.wallet) || !Number.isFinite(player.pnl_usd)) || new Set(players.map((player) => player.wallet)).size !== 50) {
    blockers.push("The saved roster must contain 50 unique wallets ranked 1–50 before opening entries.");
    return { ...blocked(blockers), season, prizeWallet, dailyPrizeLamports: prizeText, requiredBalanceLamports: requiredBalance.toString(), currentBalanceLamports: currentBalance?.toString() ?? null };
  }

  if (season && squadSizeForSeason(season.id) === 6) {
    const community = await queryRows<{ wallet: string }>("select wallet from pf_community_players where not(wallet=any($1::text[])) limit $2", [players.map(player => player.wallet), COMMUNITY_FETCH_LIMIT + 1]);
    if (community.length > COMMUNITY_FETCH_LIMIT) return { ...blocked([`The eligible community roster exceeds scoring capacity (${COMMUNITY_FETCH_LIMIT}). Increase the reviewed scoring capacity before opening this season.`]), season };
    if (!community.length) return { ...blocked(["Register an eligible community player outside the top 50 before opening this season."]), season };
  }

  return {
    ready: true,
    blockers: [],
    season,
    prizeWallet,
    dailyPrizeLamports: prizeText,
    requiredBalanceLamports: requiredBalance.toString(),
    currentBalanceLamports: currentBalance?.toString() ?? null,
    players,
    observedAt,
  };
}
